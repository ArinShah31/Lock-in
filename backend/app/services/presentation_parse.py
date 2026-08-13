"""Extract per-slide text, pictures, and diagram regions from a PPTX."""

from __future__ import annotations

from pathlib import Path

from pptx import Presentation
from pptx.enum.shapes import MSO_SHAPE_TYPE

_DIAGRAM_WORDS = (
    "flowchart",
    "flow chart",
    "diagram",
    "architecture",
    "pipeline",
    "workflow",
    "state machine",
    "er diagram",
    "uml",
)


def _emu_pct(value, total) -> float:
    if not total:
        return 0.0
    try:
        return max(0.0, min(1.0, float(value) / float(total)))
    except Exception:
        return 0.0


def _shape_box(shape, slide_w, slide_h) -> dict[str, float]:
    left = getattr(shape, "left", 0) or 0
    top = getattr(shape, "top", 0) or 0
    width = getattr(shape, "width", 0) or 0
    height = getattr(shape, "height", 0) or 0
    return {
        "x": round(_emu_pct(left, slide_w), 4),
        "y": round(_emu_pct(top, slide_h), 4),
        "w": round(max(_emu_pct(width, slide_w), 0.04), 4),
        "h": round(max(_emu_pct(height, slide_h), 0.04), 4),
    }


def _shape_kind(shape) -> str:
    try:
        shape_type = shape.shape_type
    except Exception:
        return "text"
    picture_types = {MSO_SHAPE_TYPE.PICTURE}
    if hasattr(MSO_SHAPE_TYPE, "LINKED_PICTURE"):
        picture_types.add(MSO_SHAPE_TYPE.LINKED_PICTURE)
    if shape_type in picture_types:
        return "picture"
    if shape_type == MSO_SHAPE_TYPE.CHART:
        return "chart"
    if shape_type == MSO_SHAPE_TYPE.GROUP:
        return "group"
    if shape_type in {MSO_SHAPE_TYPE.LINE, MSO_SHAPE_TYPE.FREEFORM}:
        return "connector"
    return "text"


def _shape_text(shape) -> str:
    if getattr(shape, "has_text_frame", False):
        return (shape.text or "").strip()
    if hasattr(shape, "text"):
        try:
            return (shape.text or "").strip()
        except Exception:
            return ""
    return ""


def _collect_shapes(shapes, slide_w, slide_h, collected: list[dict], texts: list[str], stats: dict) -> None:
    for shape in shapes:
        kind = _shape_kind(shape)
        box = _shape_box(shape, slide_w, slide_h)
        if kind == "group":
            stats["visuals"] += 1
            collected.append(
                {
                    "index": len(collected),
                    "kind": "group",
                    "text": "",
                    **box,
                }
            )
            try:
                _collect_shapes(shape.shapes, slide_w, slide_h, collected, texts, stats)
            except Exception:
                pass
            continue
        if kind in {"picture", "chart"}:
            stats["visuals"] += 1
            collected.append(
                {
                    "index": len(collected),
                    "kind": kind,
                    "text": _shape_text(shape),
                    **box,
                }
            )
            continue
        if kind == "connector":
            stats["connectors"] += 1
            continue
        text = _shape_text(shape)
        if not text:
            continue
        texts.append(text)
        collected.append(
            {
                "index": len(collected),
                "kind": "text",
                "text": text,
                "x": round(max(box["x"], 0), 4),
                "y": round(max(box["y"], 0), 4),
                "w": round(max(box["w"], 0.08), 4),
                "h": round(max(box["h"], 0.06), 4),
            }
        )


def slide_looks_like_diagram(shapes: list[dict] | None, extracted_text: str = "") -> bool:
    items = shapes or []
    if any(str(item.get("kind") or "") in {"picture", "chart", "group"} for item in items):
        return True
    lowered = (extracted_text or "").lower()
    return any(word in lowered for word in _DIAGRAM_WORDS)


def extract_slides(file_path: str) -> list[dict]:
    presentation = Presentation(file_path)
    slide_w = presentation.slide_width or 1
    slide_h = presentation.slide_height or 1
    slides: list[dict] = []

    for index, slide in enumerate(presentation.slides):
        collected: list[dict] = []
        texts: list[str] = []
        stats = {"visuals": 0, "connectors": 0}
        try:
            _collect_shapes(slide.shapes, slide_w, slide_h, collected, texts, stats)
        except Exception:
            pass
        extracted = "\n".join(texts).strip()
        has_diagram = stats["visuals"] > 0 or stats["connectors"] >= 3 or slide_looks_like_diagram(
            collected, extracted
        )
        slides.append(
            {
                "index": index,
                "extracted_text": extracted,
                "script": extracted or f"Slide {index + 1}.",
                "shapes": collected,
                "has_diagram": has_diagram,
            }
        )

    if not slides:
        slides.append(
            {
                "index": 0,
                "extracted_text": Path(file_path).stem,
                "script": f"This presentation is titled {Path(file_path).stem}.",
                "shapes": [],
                "has_diagram": False,
            }
        )
    return slides
