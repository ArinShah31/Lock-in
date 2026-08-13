"""Extract per-slide text and shape bounding boxes from a PPTX."""

from __future__ import annotations

from pathlib import Path

from pptx import Presentation
from pptx.enum.shapes import MSO_SHAPE_TYPE


def _emu_pct(value, total) -> float:
    if not total:
        return 0.0
    try:
        return max(0.0, min(1.0, float(value) / float(total)))
    except Exception:
        return 0.0


def extract_slides(file_path: str) -> list[dict]:
    presentation = Presentation(file_path)
    slide_w = presentation.slide_width or 1
    slide_h = presentation.slide_height or 1
    slides: list[dict] = []

    for index, slide in enumerate(presentation.slides):
        shapes: list[dict] = []
        texts: list[str] = []
        shape_i = 0
        for shape in slide.shapes:
            text = ""
            if getattr(shape, "has_text_frame", False):
                text = (shape.text or "").strip()
            elif hasattr(shape, "text"):
                text = (shape.text or "").strip()
            if not text:
                continue
            if shape.shape_type == MSO_SHAPE_TYPE.GROUP:
                continue
            texts.append(text)
            left = getattr(shape, "left", 0) or 0
            top = getattr(shape, "top", 0) or 0
            width = getattr(shape, "width", 0) or 0
            height = getattr(shape, "height", 0) or 0
            shapes.append(
                {
                    "index": shape_i,
                    "text": text,
                    "x": round(_emu_pct(left, slide_w), 4),
                    "y": round(_emu_pct(top, slide_h), 4),
                    "w": round(max(_emu_pct(width, slide_w), 0.08), 4),
                    "h": round(max(_emu_pct(height, slide_h), 0.06), 4),
                }
            )
            shape_i += 1

        extracted = "\n".join(texts).strip()
        slides.append(
            {
                "index": index,
                "extracted_text": extracted,
                "script": extracted or f"Slide {index + 1}.",
                "shapes": shapes,
            }
        )

    if not slides:
        slides.append(
            {
                "index": 0,
                "extracted_text": Path(file_path).stem,
                "script": f"This presentation is titled {Path(file_path).stem}.",
                "shapes": [],
            }
        )
    return slides
