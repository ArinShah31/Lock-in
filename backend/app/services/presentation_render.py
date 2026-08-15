"""Slide image backends: PowerPoint COM first, LibreOffice headless fallback."""

from __future__ import annotations

import gc
import re
import shutil
import subprocess
import tempfile
import uuid
from pathlib import Path

from PIL import Image

LOG = "[RENDER]"


class SlideRenderError(RuntimeError):
    """Both renderers failed, or rendered images failed validation."""


def _log(message: str) -> None:
    text = str(message).encode("ascii", "replace").decode("ascii")
    print(f"{LOG} {text}", flush=True)


def _natural_key(name: str) -> list:
    return [int(part) if part.isdigit() else part.lower() for part in re.split(r"(\d+)", name)]


def list_pngs(folder: Path) -> list[str]:
    if not folder.is_dir():
        return []
    files = sorted(
        [p for p in folder.iterdir() if p.suffix.lower() == ".png"],
        key=lambda p: _natural_key(p.name),
    )
    return [str(p) for p in files]


def _clear_pngs(folder: Path) -> None:
    for png in list_pngs(folder):
        Path(png).unlink(missing_ok=True)


def _libreoffice_bin() -> str | None:
    binary = shutil.which("soffice") or shutil.which("soffice.exe") or shutil.which("libreoffice")
    if binary:
        return binary
    for candidate in (
        r"C:\Program Files\LibreOffice\program\soffice.exe",
        r"C:\Program Files (x86)\LibreOffice\program\soffice.exe",
    ):
        if Path(candidate).exists():
            return candidate
    return None


def validate_pptx_file(pptx_path: str) -> Path:
    path = Path(pptx_path).resolve()
    if not path.is_file():
        raise SlideRenderError(f"PPTX is missing: {path}")
    if path.suffix.lower() != ".pptx":
        raise SlideRenderError("Upload a .pptx file")
    if path.stat().st_size < 64:
        raise SlideRenderError("The uploaded PPTX is empty or truncated")
    import zipfile

    if not zipfile.is_zipfile(path):
        raise SlideRenderError("The uploaded file is not a valid PPTX archive")
    return path


def validate_slide_images(paths: list[str], expected_count: int) -> None:
    if expected_count < 1:
        raise SlideRenderError("This presentation has no slides")
    if len(paths) != expected_count:
        raise SlideRenderError(
            f"Rendered {len(paths)} slide image(s) but the deck has {expected_count} slides"
        )
    for i, raw in enumerate(paths):
        path = Path(raw)
        if not path.is_file():
            raise SlideRenderError(f"Missing slide image {i + 1}: {path}")
        if path.stat().st_size < 32:
            raise SlideRenderError(f"Slide image {i + 1} is empty: {path.name}")
        try:
            with Image.open(path) as image:
                image.load()
                width, height = image.size
        except Exception as exc:  # noqa: BLE001
            raise SlideRenderError(f"Slide image {i + 1} is unreadable: {exc}") from exc
        if width < 8 or height < 8:
            raise SlideRenderError(f"Slide image {i + 1} is too small ({width}x{height})")
    _log(f"Image validation succeeded ({expected_count} PNG{'s' if expected_count != 1 else ''})")


def _unblock_windows_file(path: Path) -> None:
    """Drop Mark-of-the-Web so PowerPoint COM will open downloaded PPTX files."""
    stream = f"{path}:Zone.Identifier"
    try:
        Path(stream).unlink(missing_ok=True)
    except OSError:
        pass
    try:
        subprocess.run(
            ["powershell", "-NoProfile", "-Command", f'Unblock-File -LiteralPath "{path}"'],
            capture_output=True,
            timeout=15,
        )
    except Exception:
        pass


def _copy_to_temp(pptx: Path) -> Path:
    dest = Path(tempfile.gettempdir()) / f"astra-ppt-{uuid.uuid4().hex}.pptx"
    shutil.copyfile(pptx, dest)
    _unblock_windows_file(dest)
    return dest


def _open_presentation(app, pptx: Path):
    target = str(pptx)
    attempts = [
        ("read-only", (True, False, False)),
        ("writable", (False, False, False)),
        ("with window", (True, False, True)),
    ]
    last_exc: Exception | None = None
    for label, args in attempts:
        _log(f"PowerPoint opening ({label}): {pptx.name}")
        try:
            return app.Presentations.Open(target, *args)
        except Exception as exc:  # noqa: BLE001
            last_exc = exc
            _log(f"PowerPoint {label} open failed: {exc}")
    try:
        _log("PowerPoint opening (OpenAndRepair)")
        return app.Presentations.Open2007(target, True, False, False, True)
    except Exception as exc:  # noqa: BLE001
        last_exc = exc
        _log(f"PowerPoint OpenAndRepair failed: {exc}")
    raise last_exc or SlideRenderError("PowerPoint could not open the file")


def _rewrite_pptx(pptx: Path) -> Path:
    from pptx import Presentation

    dest = Path(tempfile.gettempdir()) / f"astra-ppt-rewrite-{uuid.uuid4().hex}.pptx"
    Presentation(str(pptx)).save(str(dest))
    _unblock_windows_file(dest)
    return dest


def render_with_powerpoint(pptx_path: str, out_dir: str) -> list[str]:
    """Primary renderer: Microsoft PowerPoint COM, read-only, then quit cleanly."""
    pptx = Path(pptx_path).resolve()
    dest = Path(out_dir).resolve()
    dest.mkdir(parents=True, exist_ok=True)
    _log(f"PowerPoint starting: {pptx}")

    backend = None
    try:
        import comtypes.client as comtypes_client

        backend = "comtypes"
    except Exception:
        try:
            import win32com.client as win32
        except Exception as exc:  # noqa: BLE001
            raise SlideRenderError(f"PowerPoint COM libraries are unavailable: {exc}") from exc
        backend = "win32com"

    temp = _copy_to_temp(pptx)
    rewritten: Path | None = None
    app = None
    pres = None
    try:
        if backend == "comtypes":
            app = comtypes_client.CreateObject("PowerPoint.Application")
        else:
            app = win32.Dispatch("PowerPoint.Application")
        try:
            app.DisplayAlerts = 0
        except Exception:
            pass
        try:
            app.AutomationSecurity = 1
        except Exception:
            pass
        try:
            app.Visible = 0
        except Exception:
            try:
                app.Visible = 1
            except Exception:
                pass

        try:
            pres = _open_presentation(app, temp)
        except Exception as open_exc:  # noqa: BLE001
            _log(f"PowerPoint direct open failed: {open_exc}")
            rewritten = _rewrite_pptx(pptx)
            _log(f"PowerPoint retrying with rewritten PPTX: {rewritten.name}")
            pres = _open_presentation(app, rewritten)

        _log(f"PowerPoint exporting PNG to {dest}")
        pres.Export(str(dest), "PNG")
        try:
            pres.Close()
        except Exception:
            pass
        pres = None
        pngs = list_pngs(dest)
        if not pngs:
            raise SlideRenderError("PowerPoint exported no PNG files")
        _log(f"PowerPoint succeeded ({len(pngs)} slide images)")
        return pngs
    except Exception as exc:  # noqa: BLE001
        raise SlideRenderError(str(exc)) from exc
    finally:
        if pres is not None:
            try:
                pres.Close()
            except Exception:
                pass
        if app is not None:
            try:
                app.Quit()
            except Exception:
                pass
        pres = None
        app = None
        gc.collect()
        temp.unlink(missing_ok=True)
        if rewritten is not None:
            rewritten.unlink(missing_ok=True)


def render_with_libreoffice(pptx_path: str, out_dir: str) -> list[str]:
    """Fallback renderer: PPTX → PDF (LibreOffice) → PNG (PyMuPDF)."""
    pptx = Path(pptx_path).resolve()
    dest = Path(out_dir).resolve()
    dest.mkdir(parents=True, exist_ok=True)
    binary = _libreoffice_bin()
    if not binary:
        raise SlideRenderError("LibreOffice is not installed")

    try:
        import fitz
    except Exception as exc:  # noqa: BLE001
        raise SlideRenderError(f"PyMuPDF is required for LibreOffice PNG export: {exc}") from exc

    pdf_dir = dest / "_pdf"
    pdf_dir.mkdir(parents=True, exist_ok=True)
    _log(f"LibreOffice converting to PDF: {pptx}")
    result = subprocess.run(
        [
            binary,
            "--headless",
            "--norestore",
            "--nofirststartwizard",
            "--convert-to",
            "pdf",
            "--outdir",
            str(pdf_dir),
            str(pptx),
        ],
        capture_output=True,
        text=True,
        timeout=240,
    )
    if result.returncode != 0:
        err = (result.stderr or result.stdout or "LibreOffice convert failed").strip()[-800:]
        raise SlideRenderError(err or "LibreOffice convert failed")

    pdfs = sorted(pdf_dir.glob("*.pdf"))
    if not pdfs:
        raise SlideRenderError("LibreOffice did not produce a PDF")
    pdf_path = pdfs[0]
    _log(f"LibreOffice PDF ready: {pdf_path.name}")

    paths: list[str] = []
    doc = fitz.open(str(pdf_path))
    try:
        for i, page in enumerate(doc):
            pix = page.get_pixmap(matrix=fitz.Matrix(2, 2), alpha=False)
            out = dest / f"slide-{i}.png"
            pix.save(str(out))
            paths.append(str(out))
    finally:
        doc.close()
    if not paths:
        raise SlideRenderError("LibreOffice PDF produced no PNG pages")
    _log(f"LibreOffice fallback succeeded ({len(paths)} slide images)")
    return paths


def export_slide_images(
    pptx_path: str,
    out_dir: str,
    expected_count: int,
) -> list[str]:
    """PowerPoint first, LibreOffice if needed. Raises if images cannot be validated."""
    pptx = validate_pptx_file(pptx_path)
    dest = Path(out_dir).resolve()
    dest.mkdir(parents=True, exist_ok=True)

    existing = list_pngs(dest)
    if existing:
        try:
            validate_slide_images(existing, expected_count)
            _log(f"Using {len(existing)} cached slide image(s)")
            return existing
        except SlideRenderError:
            _log("Cached slide images failed validation; re-rendering")
            _clear_pngs(dest)

    powerpoint_error: str | None = None
    try:
        pngs = render_with_powerpoint(str(pptx), str(dest))
        validate_slide_images(pngs, expected_count)
        _log("Continuing pipeline")
        return pngs
    except Exception as exc:  # noqa: BLE001
        powerpoint_error = str(exc)
        _log(f"PowerPoint failed: {powerpoint_error}")
        _clear_pngs(dest)

    _log("Starting LibreOffice fallback...")
    try:
        pngs = render_with_libreoffice(str(pptx), str(dest))
        validate_slide_images(pngs, expected_count)
        _log("Generated slide images")
        _log("Continuing pipeline")
        return pngs
    except Exception as exc:  # noqa: BLE001
        libre_error = str(exc)
        _log(f"LibreOffice failed: {libre_error}")
        _log("Both renderers failed")
        _clear_pngs(dest)
        raise SlideRenderError(
            "Could not render the original slides. "
            f"PowerPoint: {powerpoint_error}. LibreOffice: {libre_error}"
        ) from exc
