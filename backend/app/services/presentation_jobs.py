"""Background PPT-to-video generation so the HTTP request does not carry the whole job."""

from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor, as_completed
import threading
from datetime import datetime, timezone
from pathlib import Path

from sqlalchemy.orm import Session

from app.core.database import SessionLocal
from app.models.presentation import ClassroomPresentation, PresentationStatus
from app.services.presentation_media import build_cues
from app.services.presentation_parse import extract_slides
from app.services.presentation_render import SlideRenderError, export_slide_images, validate_slide_images
from app.services.presentation_scripts import expand_slide_scripts, needs_script_expansion
from app.services.presentation_tts import probe_audio_duration_ms, synthesize_slide
from app.services.presentation_video import build_narrated_video

UPLOAD_ROOT = Path("uploads/presentations")

_running_lock = threading.Lock()
_running: dict[int, int] = {}
_job_seq = 0


def _now() -> datetime:
    return datetime.now(timezone.utc)


def job_is_running(presentation_id: int) -> bool:
    with _running_lock:
        return presentation_id in _running


def _claim_job(presentation_id: int, *, force: bool = False) -> int | None:
    global _job_seq
    with _running_lock:
        if presentation_id in _running and not force:
            return None
        _job_seq += 1
        _running[presentation_id] = _job_seq
        return _job_seq


def _clear_job(presentation_id: int, token: int | None = None) -> None:
    with _running_lock:
        current = _running.get(presentation_id)
        if token is None or current == token:
            _running.pop(presentation_id, None)


def _fail_row(db: Session, row: ClassroomPresentation | None, message: str) -> None:
    if not row:
        return
    row.status = PresentationStatus.FAILED
    row.error_message = message[:2000]
    row.progress_message = None
    row.updated_at = _now()
    db.commit()


def _run_job(fn, presentation_id: int, *, kind: str, crash_label: str, token: int) -> None:
    print(f"[presentations] {kind} job started id={presentation_id}", flush=True)
    db = SessionLocal()
    try:
        row = db.query(ClassroomPresentation).filter(ClassroomPresentation.id == presentation_id).first()
        if not row:
            print(f"[presentations] {crash_label}: presentation {presentation_id} not found", flush=True)
            return
        if not row.is_active:
            _fail_row(db, row, "Presentation is no longer active.")
            print(f"[presentations] {crash_label}: presentation {presentation_id} is inactive", flush=True)
            return
        _set_progress(db, row, "Starting…")
        fn(db, presentation_id)
    except Exception as exc:  # noqa: BLE001
        print(f"[presentations] {crash_label} crashed: {exc}", flush=True)
        try:
            row = db.query(ClassroomPresentation).filter(ClassroomPresentation.id == presentation_id).first()
            _fail_row(db, row, str(exc))
        except Exception:
            db.rollback()
    finally:
        db.close()
        _clear_job(presentation_id, token)
        print(f"[presentations] {kind} job finished id={presentation_id}", flush=True)


def start_prepare_job(presentation_id: int, *, force: bool = False) -> None:
    token = _claim_job(presentation_id, force=force)
    if token is None:
        print(f"[presentations] prepare already running id={presentation_id}", flush=True)
        return
    print(f"[presentations] starting prepare job id={presentation_id}", flush=True)
    thread = threading.Thread(
        target=_run_job,
        args=(_execute_prepare_job, presentation_id),
        kwargs={"kind": "prepare", "crash_label": "prepare job", "token": token},
        daemon=True,
    )
    thread.start()


def start_video_job(presentation_id: int, *, force: bool = False) -> None:
    token = _claim_job(presentation_id, force=force)
    if token is None:
        print(f"[presentations] video already running id={presentation_id}", flush=True)
        return
    print(f"[presentations] starting video job id={presentation_id}", flush=True)
    thread = threading.Thread(
        target=_run_job,
        args=(_execute_video_job, presentation_id),
        kwargs={"kind": "video", "crash_label": "background video job", "token": token},
        daemon=True,
    )
    thread.start()


def fail_orphaned_video_jobs(
    *,
    reason: str = "Interrupted — server restarted. Open the presentation again.",
) -> int:
    db = SessionLocal()
    try:
        rows = (
            db.query(ClassroomPresentation)
            .filter(
                ClassroomPresentation.status.in_(
                    (PresentationStatus.GENERATING, PresentationStatus.PREPARING)
                )
            )
            .all()
        )
        if not rows:
            return 0
        for row in rows:
            row.status = PresentationStatus.FAILED
            row.error_message = reason[:2000]
            row.progress_message = "Interrupted"
            row.updated_at = _now()
        db.commit()
        return len(rows)
    finally:
        db.close()


def _set_progress(db: Session, row: ClassroomPresentation, message: str) -> None:
    row.progress_message = message
    row.updated_at = _now()
    db.commit()


def _refresh_shapes(db: Session, row: ClassroomPresentation, slides: list) -> None:
    try:
        fresh = extract_slides(row.file_path)
        by_index = {int(item["index"]): item for item in fresh}
        for slide in slides:
            item = by_index.get(slide.index)
            if item:
                slide.shapes = item.get("shapes") or slide.shapes or []
                cleaned = (item.get("extracted_text") or "").strip()
                if cleaned:
                    slide.extracted_text = cleaned
        db.commit()
    except Exception as parse_exc:  # noqa: BLE001
        print(f"[presentations] re-parse skipped: {parse_exc}")


def _render_slide_images(db: Session, row: ClassroomPresentation, slides: list) -> None:
    folder = UPLOAD_ROOT / str(row.classroom_id)
    pngs = export_slide_images(
        row.file_path,
        str(folder / f"{row.id}-slides"),
        expected_count=len(slides),
    )
    if len(pngs) < len(slides):
        raise RuntimeError(
            f"Rendered {len(pngs)} slide image(s) but the deck has {len(slides)} slides"
        )
    for slide, png in zip(slides, pngs):
        slide.image_path = png
    db.commit()


def _expand_scripts(db: Session, row: ClassroomPresentation, slides: list) -> None:
    expanded = expand_slide_scripts(
        [
            {
                "index": s.index,
                "extracted_text": s.extracted_text or "",
                "script": s.script or "",
                "shapes": s.shapes or [],
                "image_path": s.image_path or "",
            }
            for s in slides
        ],
        title=row.title,
        on_progress=lambda done, total: _set_progress(
            db, row, f"Writing narration {done}/{total}…"
        ),
    )
    for slide, script in zip(slides, expanded):
        if needs_script_expansion(slide.script or "", slide.extracted_text or ""):
            slide.script = script
            slide.audio_path = None
    db.commit()


def _execute_prepare_job(db: Session, presentation_id: int) -> None:
    row = db.query(ClassroomPresentation).filter(ClassroomPresentation.id == presentation_id).first()
    if not row or not row.is_active:
        raise RuntimeError("Presentation is missing or inactive")
    slides = sorted(row.slides, key=lambda s: s.index)
    if not slides:
        raise RuntimeError("This presentation has no slides")

    _set_progress(db, row, "Reading slide layout…")
    _refresh_shapes(db, row, slides)

    _set_progress(db, row, f"Rendering {len(slides)} original slides…")
    try:
        _render_slide_images(db, row, slides)
    except SlideRenderError as exc:
        raise RuntimeError(str(exc)) from exc

    if not all(s.image_path for s in slides):
        raise RuntimeError("Slide rendering did not produce an image for every slide")

    row.error_message = None
    _set_progress(db, row, "Writing explanatory narration…")
    _expand_scripts(db, row, slides)

    row.status = PresentationStatus.SCRIPTS_READY
    row.progress_message = None
    row.updated_at = _now()
    db.commit()
    print(f"[presentations] prepared presentation {presentation_id}", flush=True)


def _slides_have_valid_images(slides: list) -> bool:
    paths = [str(s.image_path or "") for s in slides]
    if not all(paths):
        return False
    try:
        validate_slide_images(paths, len(slides))
        return True
    except Exception:
        return False


def _execute_video_job(db: Session, presentation_id: int) -> None:
    row = db.query(ClassroomPresentation).filter(ClassroomPresentation.id == presentation_id).first()
    if not row or not row.is_active:
        raise RuntimeError("Presentation is missing or inactive")
    folder = UPLOAD_ROOT / str(row.classroom_id)
    audio_dir = folder / f"{row.id}-audio"
    audio_dir.mkdir(parents=True, exist_ok=True)

    slides = sorted(row.slides, key=lambda s: s.index)
    if not slides:
        raise RuntimeError("This presentation has no slides")

    _set_progress(db, row, "Reading slide layout…")
    _refresh_shapes(db, row, slides)

    if _slides_have_valid_images(slides):
        _set_progress(db, row, "Slide images ready…")
    else:
        _set_progress(db, row, f"Rendering {len(slides)} original slides…")
        _render_slide_images(db, row, slides)
        if not all(s.image_path for s in slides):
            raise RuntimeError("Slide rendering did not produce an image for every slide")

    needs_ai = any(
        needs_script_expansion(s.script or "", s.extracted_text or "") for s in slides
    )
    if needs_ai:
        _set_progress(db, row, "Writing explanatory narration…")
        _expand_scripts(db, row, slides)
    else:
        _set_progress(db, row, "Scripts ready — starting voiceover…")

    total = len(slides)
    pending: list[tuple[int, str, str]] = []
    for i, slide in enumerate(slides, start=1):
        existing = Path(slide.audio_path) if slide.audio_path else None
        if existing and existing.exists() and slide.duration_ms > 0:
            probed = probe_audio_duration_ms(str(existing))
            if probed > slide.duration_ms:
                slide.duration_ms = probed
            slide.cues = build_cues(slide.script, slide.shapes or [], slide.duration_ms)
            db.commit()
            _set_progress(db, row, f"Voiceover {i}/{total}…")
            continue
        pending.append((slide.index, slide.script or "", str(audio_dir / f"slide-{slide.index}.wav")))

    if pending:
        _set_progress(db, row, f"Voiceover 0/{total}…")
        finished = total - len(pending)

        def _synth(item: tuple[int, str, str]) -> tuple[int, float, str]:
            index, script, dest = item
            duration, audio_path = synthesize_slide(script, dest, prefer_edge=True)
            probed = probe_audio_duration_ms(audio_path)
            return index, max(duration, probed), audio_path

        workers = min(4, len(pending))
        with ThreadPoolExecutor(max_workers=workers) as pool:
            futures = [pool.submit(_synth, item) for item in pending]
            by_index = {s.index: s for s in slides}
            for fut in as_completed(futures):
                index, duration, audio_path = fut.result()
                slide = by_index[index]
                slide.audio_path = audio_path
                slide.duration_ms = duration
                slide.cues = build_cues(slide.script, slide.shapes or [], duration)
                finished += 1
                _set_progress(db, row, f"Voiceover {finished}/{total}…")
                db.commit()

    _set_progress(db, row, "Encoding video with highlights…")
    video_path = folder / f"{row.id}-narrated.mp4"
    build_narrated_video(
        [
            {
                "image_path": s.image_path or "",
                "audio_path": s.audio_path or "",
                "duration_ms": s.duration_ms,
                "shapes": s.shapes or [],
                "cues": s.cues or [],
            }
            for s in slides
        ],
        str(video_path),
    )
    row.video_path = str(video_path)
    row.status = PresentationStatus.VIDEO_READY
    row.error_message = None
    row.progress_message = "Done"
    row.updated_at = _now()
    db.commit()
    print(f"[presentations] background video ready for presentation {presentation_id}", flush=True)
