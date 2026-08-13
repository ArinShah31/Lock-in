"""PPTX → PDF → per-slide PNG, plus highlight cue timing."""

from __future__ import annotations

import re
import shutil
import subprocess
from pathlib import Path


def convert_pptx_to_pdf(pptx_path: str, out_dir: str) -> str | None:
    dest = Path(out_dir)
    dest.mkdir(parents=True, exist_ok=True)
    pptx = Path(pptx_path)
    binary = (
        shutil.which("soffice")
        or shutil.which("soffice.exe")
        or shutil.which("libreoffice")
    )
    if not binary:
        for candidate in (
            r"C:\Program Files\LibreOffice\program\soffice.exe",
            r"C:\Program Files (x86)\LibreOffice\program\soffice.exe",
        ):
            if Path(candidate).exists():
                binary = candidate
                break
    if not binary:
        print("[presentations] LibreOffice not found; skipping PDF conversion")
        return None
    try:
        subprocess.run(
            [binary, "--headless", "--convert-to", "pdf", "--outdir", str(dest), str(pptx)],
            check=True,
            timeout=90,
            capture_output=True,
        )
    except Exception as exc:  # noqa: BLE001
        print(f"[presentations] PDF conversion failed: {exc}")
        return None
    pdf = dest / f"{pptx.stem}.pdf"
    return str(pdf) if pdf.exists() else None


def render_slide_pngs(pdf_path: str, out_dir: str) -> list[str]:
    try:
        import fitz
    except Exception:
        return []
    dest = Path(out_dir)
    dest.mkdir(parents=True, exist_ok=True)
    paths: list[str] = []
    try:
        doc = fitz.open(pdf_path)
        for i, page in enumerate(doc):
            pix = page.get_pixmap(matrix=fitz.Matrix(2, 2), alpha=False)
            out = dest / f"slide-{i}.png"
            pix.save(str(out))
            paths.append(str(out))
        doc.close()
    except Exception as exc:  # noqa: BLE001
        print(f"[presentations] PNG render failed: {exc}")
        return []
    return paths


def _export_with_powerpoint(pptx_path: str, out_dir: str) -> list[str]:
    pptx = str(Path(pptx_path).resolve())
    dest = Path(out_dir).resolve()
    dest.mkdir(parents=True, exist_ok=True)
    try:
        import comtypes.client
    except Exception:
        try:
            import win32com.client as win32
        except Exception:
            return []
        app = win32.Dispatch("PowerPoint.Application")
        try:
            app.Visible = 1
            pres = app.Presentations.Open(pptx, WithWindow=False)
            pres.Export(str(dest), "PNG")
            pres.Close()
        finally:
            app.Quit()
        return _sorted_export_pngs(dest)

    app = comtypes.client.CreateObject("PowerPoint.Application")
    try:
        app.Visible = 1
        pres = app.Presentations.Open(pptx, WithWindow=False)
        pres.Export(str(dest), "PNG")
        pres.Close()
    finally:
        try:
            app.Quit()
        except Exception:
            pass
    return _sorted_export_pngs(dest)


def _sorted_export_pngs(folder: Path) -> list[str]:
    def _natural_key(name: str) -> list:
        return [int(part) if part.isdigit() else part.lower() for part in re.split(r"(\d+)", name)]

    files = sorted(
        [p for p in folder.iterdir() if p.suffix.lower() == ".png"],
        key=lambda p: _natural_key(p.name),
    )
    return [str(p) for p in files]


def export_slide_images(
    pptx_path: str,
    out_dir: str,
    expected_count: int | None = None,
) -> list[str]:
    """Export the original PPTX pages as PNGs (PowerPoint, then LibreOffice)."""
    dest = Path(out_dir)
    dest.mkdir(parents=True, exist_ok=True)
    existing = _sorted_export_pngs(dest)
    if existing and (expected_count is None or len(existing) == expected_count):
        return existing
    if existing:
        for png in existing:
            Path(png).unlink(missing_ok=True)

    pngs = _export_with_powerpoint(pptx_path, str(dest))
    if pngs:
        print(f"[presentations] exported {len(pngs)} slide image(s) via PowerPoint")
        return pngs

    pdf = convert_pptx_to_pdf(pptx_path, str(dest / "_pdf"))
    if pdf:
        pngs = render_slide_pngs(pdf, str(dest))
        if pngs:
            print(f"[presentations] exported {len(pngs)} slide image(s) via LibreOffice")
            return pngs

    raise RuntimeError(
        "Could not render the original slides. Install Microsoft PowerPoint or LibreOffice "
        "so ASTRA can convert the PPTX into a video."
    )


_SENTENCE_RE = re.compile(r"(?<=[.!?])\s+|\n+")


def split_script_chunks(script: str) -> list[str]:
    text = (script or "").strip()
    if not text:
        return []
    parts = [p.strip() for p in _SENTENCE_RE.split(text) if p and p.strip()]
    return parts or [text]


def _overlap_score(chunk: str, shape_text: str) -> int:
    chunk_tokens = {t for t in re.findall(r"[a-z0-9]{3,}", chunk.lower())}
    shape_tokens = {t for t in re.findall(r"[a-z0-9]{3,}", shape_text.lower())}
    if not chunk_tokens or not shape_tokens:
        return 0
    return len(chunk_tokens & shape_tokens)


def build_cues(script: str, shapes: list[dict], duration_ms: float) -> list[dict]:
    chunks = split_script_chunks(script)
    if not chunks:
        return []
    duration_ms = max(float(duration_ms or 0), 800.0)
    weights = [max(len(c), 1) for c in chunks]
    total = sum(weights)
    cursor = 0.0
    cues: list[dict] = []
    for i, chunk in enumerate(chunks):
        span = duration_ms * (weights[i] / total)
        start = cursor
        end = duration_ms if i == len(chunks) - 1 else cursor + span
        best_idx = None
        best_score = 0
        for shape in shapes or []:
            score = _overlap_score(chunk, str(shape.get("text") or ""))
            if score > best_score:
                best_score = score
                best_idx = int(shape.get("index", 0))
        if best_score == 0 and shapes:
            best_idx = int(shapes[min(i, len(shapes) - 1)].get("index", i))
        cues.append(
            {
                "start_ms": round(start, 1),
                "end_ms": round(end, 1),
                "text": chunk,
                "shape_index": best_idx,
            }
        )
        cursor = end
    return cues
