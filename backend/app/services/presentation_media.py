"""Highlight cue timing from narration + structured slide elements."""

from __future__ import annotations

import re

from app.services.presentation_parse import (
    content_text,
    is_content_visual,
    is_highlightable,
    line_is_boilerplate,
    slide_looks_like_diagram,
)
from app.services.presentation_render import export_slide_images

__all__ = ["build_cues", "export_slide_images", "split_script_chunks"]


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
    content_shapes = [shape for shape in (shapes or []) if is_highlightable(shape)]
    cues: list[dict] = []
    for i, chunk in enumerate(chunks):
        span = duration_ms * (weights[i] / total)
        start = cursor
        end = duration_ms if i == len(chunks) - 1 else cursor + span
        best_idx = None
        best_score = 0
        if not line_is_boilerplate(chunk):
            chunk_text = content_text(chunk) or chunk
            for shape in content_shapes:
                score = _overlap_score(chunk_text, content_text(str(shape.get("text") or "")) or str(shape.get("text") or ""))
                area = float(shape.get("w") or 0) * float(shape.get("h") or 0)
                if area > 0.5:
                    score = max(0, score - 1)
                if score > best_score:
                    best_score = score
                    best_idx = int(shape.get("index", 0))
        if best_score < 1:
            visuals = [
                shape
                for shape in content_shapes
                if is_content_visual(shape)
                and 0.08 <= float(shape.get("w") or 0) * float(shape.get("h") or 0) <= 0.7
            ]
            if visuals and slide_looks_like_diagram(shapes, script):
                best_idx = int(visuals[min(i, len(visuals) - 1)].get("index", i))
            else:
                best_idx = None
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
