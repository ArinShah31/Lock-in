"""Manual check: PowerPoint then LibreOffice against a stored PPTX."""

from __future__ import annotations

import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from app.services.presentation_parse import extract_slides
from app.services.presentation_render import export_slide_images, validate_pptx_file


def main() -> int:
    pptx = Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else None
    if not pptx or not pptx.is_file():
        print("Usage: python scripts/test_slide_render.py <file.pptx>")
        return 2
    try:
        import pythoncom

        pythoncom.CoInitialize()
    except Exception:
        try:
            import comtypes

            comtypes.CoInitialize()
        except Exception:
            pass

    path = validate_pptx_file(str(pptx))
    slides = extract_slides(str(path))
    print(f"slides={len(slides)} elements={sum(len(s.get('shapes') or []) for s in slides)}")
    if slides:
        sample = (slides[0].get("shapes") or [])[:3]
        print("sample_elements", sample)
    out = Path(tempfile.mkdtemp(prefix="astra-render-"))
    pngs = export_slide_images(str(path), str(out), expected_count=len(slides))
    print("pngs", len(pngs))
    print("first", pngs[0] if pngs else None)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
