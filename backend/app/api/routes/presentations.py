from datetime import datetime, timezone
from pathlib import Path
import shutil
import uuid

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.api.routes.classrooms import (
    _ensure_view_access,
    _get_classroom_or_404,
)
from app.core.database import get_db
from app.models.presentation import ClassroomPresentation, PresentationSlide, PresentationStatus
from app.models.user import User, UserRole
from app.schemas.presentation import (
    PresentationDetailOut,
    PresentationOut,
    PresentationSlideOut,
    SlideCueOut,
    SlideScriptPatch,
    SlideShapeOut,
)
from app.services.presentation_media import (
    build_cues,
    export_slide_images,
)
from app.services.presentation_parse import extract_slides
from app.services.presentation_scripts import expand_slide_scripts, needs_script_expansion
from app.services.presentation_tts import probe_audio_duration_ms, synthesize_slide
from app.services.presentation_video import build_narrated_video

router = APIRouter(prefix="/classrooms/{classroom_id}/presentations", tags=["presentations"])

TEACHER_ROLES = (UserRole.CLASS_TEACHER, UserRole.SUBJECT_TEACHER, UserRole.SUPER_ADMIN)
UPLOAD_ROOT = Path("uploads/presentations")


def _ensure_teacher_access(db: Session, user: User, classroom) -> None:
    _ensure_view_access(db, user, classroom)
    if user.role not in TEACHER_ROLES:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only teachers can manage presentations",
        )


def _get_presentation_or_404(
    db: Session, classroom_id: int, presentation_id: int
) -> ClassroomPresentation:
    row = (
        db.query(ClassroomPresentation)
        .filter(
            ClassroomPresentation.id == presentation_id,
            ClassroomPresentation.classroom_id == classroom_id,
            ClassroomPresentation.is_active.is_(True),
        )
        .first()
    )
    if not row:
        raise HTTPException(status_code=404, detail="Presentation not found")
    return row


def _shape_out(raw: list) -> list[SlideShapeOut]:
    out: list[SlideShapeOut] = []
    for item in raw or []:
        if not isinstance(item, dict):
            continue
        out.append(
            SlideShapeOut(
                index=int(item.get("index", 0)),
                text=str(item.get("text") or ""),
                x=float(item.get("x") or 0),
                y=float(item.get("y") or 0),
                w=float(item.get("w") or 0),
                h=float(item.get("h") or 0),
            )
        )
    return out


def _cue_out(raw: list) -> list[SlideCueOut]:
    out: list[SlideCueOut] = []
    for item in raw or []:
        if not isinstance(item, dict):
            continue
        shape_index = item.get("shape_index")
        out.append(
            SlideCueOut(
                start_ms=float(item.get("start_ms") or 0),
                end_ms=float(item.get("end_ms") or 0),
                text=str(item.get("text") or ""),
                shape_index=None if shape_index is None else int(shape_index),
            )
        )
    return out


def _slide_out(slide: PresentationSlide) -> PresentationSlideOut:
    return PresentationSlideOut(
        id=slide.id,
        presentation_id=slide.presentation_id,
        index=slide.index,
        extracted_text=slide.extracted_text or "",
        script=slide.script or "",
        duration_ms=slide.duration_ms or 0,
        has_audio=bool(slide.audio_path),
        has_image=bool(slide.image_path),
        shapes=_shape_out(slide.shapes or []),
        cues=_cue_out(slide.cues or []),
    )


def _summary(row: ClassroomPresentation) -> PresentationOut:
    return PresentationOut(
        id=row.id,
        classroom_id=row.classroom_id,
        uploaded_by=row.uploaded_by,
        title=row.title,
        file_name=row.file_name,
        status=row.status,
        error_message=row.error_message,
        slide_count=len(row.slides or []),
        has_video=bool(row.video_path),
        created_at=row.created_at,
        updated_at=row.updated_at,
    )


def _detail(row: ClassroomPresentation) -> PresentationDetailOut:
    base = _summary(row)
    return PresentationDetailOut(
        **base.model_dump(),
        slides=[_slide_out(s) for s in sorted(row.slides, key=lambda x: x.index)],
    )


def _touch(row: ClassroomPresentation) -> None:
    row.updated_at = datetime.now(timezone.utc)


@router.get("", response_model=list[PresentationOut])
def list_presentations(
    classroom_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    classroom = _get_classroom_or_404(db, classroom_id)
    _ensure_view_access(db, current_user, classroom)
    rows = (
        db.query(ClassroomPresentation)
        .filter(
            ClassroomPresentation.classroom_id == classroom_id,
            ClassroomPresentation.is_active.is_(True),
        )
        .order_by(ClassroomPresentation.id.desc())
        .all()
    )
    return [_summary(row) for row in rows]


@router.post("", response_model=PresentationDetailOut, status_code=status.HTTP_201_CREATED)
async def upload_presentation(
    classroom_id: int,
    title: str = Form(...),
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    classroom = _get_classroom_or_404(db, classroom_id)
    _ensure_teacher_access(db, current_user, classroom)

    suffix = Path(file.filename or "").suffix.lower()
    if suffix not in {".pptx"}:
        raise HTTPException(status_code=400, detail="Upload a .pptx file")

    folder = UPLOAD_ROOT / str(classroom_id)
    folder.mkdir(parents=True, exist_ok=True)
    stored = f"{uuid.uuid4()}{suffix}"
    dest = folder / stored
    with dest.open("wb") as buffer:
        shutil.copyfileobj(file.file, buffer)

    row = ClassroomPresentation(
        classroom_id=classroom_id,
        uploaded_by=current_user.id,
        title=title.strip() or Path(file.filename or "Presentation").stem,
        file_name=file.filename or stored,
        stored_name=stored,
        file_path=str(dest),
        status=PresentationStatus.UPLOADED,
    )
    db.add(row)
    db.commit()
    db.refresh(row)

    try:
        parsed = extract_slides(str(dest))
        scripts = expand_slide_scripts(parsed, title=row.title)
        for item, script in zip(parsed, scripts):
            db.add(
                PresentationSlide(
                    presentation_id=row.id,
                    index=int(item["index"]),
                    extracted_text=item.get("extracted_text") or "",
                    script=script or item.get("extracted_text") or "",
                    shapes=item.get("shapes") or [],
                    cues=[],
                )
            )
        try:
            pngs = export_slide_images(str(dest), str(folder / f"{row.id}-slides"))
            slides = (
                db.query(PresentationSlide)
                .filter(PresentationSlide.presentation_id == row.id)
                .order_by(PresentationSlide.index)
                .all()
            )
            for slide, png in zip(slides, pngs):
                slide.image_path = png
        except Exception as render_exc:  # noqa: BLE001
            print(f"[presentations] slide render skipped on upload: {render_exc}")
        row.status = PresentationStatus.SCRIPTS_READY
        row.error_message = None
    except Exception as exc:  # noqa: BLE001
        row.status = PresentationStatus.FAILED
        row.error_message = str(exc)
    _touch(row)
    db.commit()
    db.refresh(row)
    return _detail(row)


@router.get("/{presentation_id}", response_model=PresentationDetailOut)
def get_presentation(
    classroom_id: int,
    presentation_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    classroom = _get_classroom_or_404(db, classroom_id)
    _ensure_view_access(db, current_user, classroom)
    return _detail(_get_presentation_or_404(db, classroom_id, presentation_id))


@router.patch("/{presentation_id}/slides/{slide_id}", response_model=PresentationSlideOut)
def patch_slide_script(
    classroom_id: int,
    presentation_id: int,
    slide_id: int,
    payload: SlideScriptPatch,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    classroom = _get_classroom_or_404(db, classroom_id)
    _ensure_teacher_access(db, current_user, classroom)
    row = _get_presentation_or_404(db, classroom_id, presentation_id)
    slide = next((s for s in row.slides if s.id == slide_id), None)
    if not slide:
        raise HTTPException(status_code=404, detail="Slide not found")
    slide.script = payload.script.strip()
    slide.audio_path = None
    slide.duration_ms = 0
    slide.cues = []
    if row.status in {PresentationStatus.AUDIO_READY, PresentationStatus.VIDEO_READY}:
        row.status = PresentationStatus.SCRIPTS_READY
    row.video_path = None
    _touch(row)
    db.commit()
    db.refresh(slide)
    return _slide_out(slide)


@router.post("/{presentation_id}/voiceover", response_model=PresentationDetailOut)
def generate_voiceover(
    classroom_id: int,
    presentation_id: int,
    slide_id: int | None = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    classroom = _get_classroom_or_404(db, classroom_id)
    _ensure_teacher_access(db, current_user, classroom)
    row = _get_presentation_or_404(db, classroom_id, presentation_id)
    audio_dir = UPLOAD_ROOT / str(classroom_id) / f"{row.id}-audio"
    audio_dir.mkdir(parents=True, exist_ok=True)

    targets = sorted(row.slides, key=lambda s: s.index)
    if slide_id is not None:
        targets = [s for s in targets if s.id == slide_id]
        if not targets:
            raise HTTPException(status_code=404, detail="Slide not found")

    try:
        for slide in targets:
            dest = audio_dir / f"slide-{slide.index}.wav"
            duration, audio_path = synthesize_slide(slide.script, str(dest))
            slide.audio_path = audio_path
            slide.duration_ms = duration
            slide.cues = build_cues(slide.script, slide.shapes or [], duration)
        row.video_path = None
        if all(s.audio_path for s in row.slides):
            row.status = PresentationStatus.AUDIO_READY
        else:
            row.status = PresentationStatus.SCRIPTS_READY
        row.error_message = None
    except Exception as exc:  # noqa: BLE001
        row.status = PresentationStatus.FAILED
        row.error_message = str(exc)
        _touch(row)
        db.commit()
        raise HTTPException(status_code=502, detail=f"Voiceover failed: {exc}") from exc

    _touch(row)
    db.commit()
    db.refresh(row)
    return _detail(row)


@router.post("/{presentation_id}/video", response_model=PresentationDetailOut)
def generate_video(
    classroom_id: int,
    presentation_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    classroom = _get_classroom_or_404(db, classroom_id)
    _ensure_teacher_access(db, current_user, classroom)
    row = _get_presentation_or_404(db, classroom_id, presentation_id)
    folder = UPLOAD_ROOT / str(classroom_id)
    audio_dir = folder / f"{row.id}-audio"
    audio_dir.mkdir(parents=True, exist_ok=True)

    try:
        slides = sorted(row.slides, key=lambda s: s.index)
        if not slides:
            raise RuntimeError("This presentation has no slides")
        expanded = expand_slide_scripts(
            [
                {
                    "index": s.index,
                    "extracted_text": s.extracted_text or "",
                    "script": s.script or "",
                    "shapes": s.shapes or [],
                }
                for s in slides
            ],
            title=row.title,
        )
        for slide, script in zip(slides, expanded):
            if needs_script_expansion(slide.script or "", slide.extracted_text or ""):
                slide.script = script
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
            dest = audio_dir / f"slide-{slide.index}.wav"
            duration, audio_path = synthesize_slide(slide.script, str(dest))
            probed = probe_audio_duration_ms(audio_path)
            if probed > duration:
                duration = probed
            slide.audio_path = audio_path
            slide.duration_ms = duration
            slide.cues = build_cues(slide.script, slide.shapes or [], duration)

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
    except Exception as exc:  # noqa: BLE001
        row.status = PresentationStatus.FAILED
        row.error_message = str(exc)
        _touch(row)
        db.commit()
        raise HTTPException(status_code=502, detail=f"Video generation failed: {exc}") from exc

    _touch(row)
    db.commit()
    db.refresh(row)
    return _detail(row)


@router.delete("/{presentation_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_presentation(
    classroom_id: int,
    presentation_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    classroom = _get_classroom_or_404(db, classroom_id)
    _ensure_teacher_access(db, current_user, classroom)
    row = _get_presentation_or_404(db, classroom_id, presentation_id)
    row.is_active = False
    _touch(row)
    db.commit()
    return None


@router.get("/{presentation_id}/download")
def download_pptx(
    classroom_id: int,
    presentation_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    classroom = _get_classroom_or_404(db, classroom_id)
    _ensure_view_access(db, current_user, classroom)
    row = _get_presentation_or_404(db, classroom_id, presentation_id)
    path = Path(row.file_path)
    if not path.exists():
        raise HTTPException(status_code=404, detail="File missing")
    return FileResponse(
        path,
        filename=row.file_name,
        media_type="application/vnd.openxmlformats-officedocument.presentationml.presentation",
    )


@router.get("/{presentation_id}/video")
def stream_video(
    classroom_id: int,
    presentation_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    classroom = _get_classroom_or_404(db, classroom_id)
    _ensure_view_access(db, current_user, classroom)
    row = _get_presentation_or_404(db, classroom_id, presentation_id)
    if not row.video_path:
        raise HTTPException(status_code=404, detail="Video not ready")
    path = Path(row.video_path)
    if not path.exists():
        raise HTTPException(status_code=404, detail="Video missing")
    return FileResponse(path, media_type="video/mp4", filename=f"{Path(row.file_name).stem}.mp4")


@router.get("/{presentation_id}/slides/{slide_id}/audio")
def stream_audio(
    classroom_id: int,
    presentation_id: int,
    slide_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    classroom = _get_classroom_or_404(db, classroom_id)
    _ensure_view_access(db, current_user, classroom)
    row = _get_presentation_or_404(db, classroom_id, presentation_id)
    slide = next((s for s in row.slides if s.id == slide_id), None)
    if not slide or not slide.audio_path:
        raise HTTPException(status_code=404, detail="Audio not ready")
    path = Path(slide.audio_path)
    if not path.exists():
        raise HTTPException(status_code=404, detail="Audio missing")
    media = "audio/mpeg" if path.suffix.lower() == ".mp3" else "audio/wav"
    return FileResponse(path, media_type=media, filename=path.name)


@router.get("/{presentation_id}/slides/{slide_id}/image")
def stream_image(
    classroom_id: int,
    presentation_id: int,
    slide_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    classroom = _get_classroom_or_404(db, classroom_id)
    _ensure_view_access(db, current_user, classroom)
    row = _get_presentation_or_404(db, classroom_id, presentation_id)
    slide = next((s for s in row.slides if s.id == slide_id), None)
    if not slide or not slide.image_path:
        raise HTTPException(status_code=404, detail="Slide image not available")
    path = Path(slide.image_path)
    if not path.exists():
        raise HTTPException(status_code=404, detail="Slide image missing")
    return FileResponse(path, media_type="image/png", filename=path.name)
