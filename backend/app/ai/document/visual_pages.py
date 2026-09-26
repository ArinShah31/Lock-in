"""Render PDF pages likely to contain diagrams, tables, or figures."""

from __future__ import annotations

import io
from pathlib import Path

import fitz
from PIL import Image

# Safety cap for very large PDFs; typical classroom decks are well below this.
ABSOLUTE_MAX_PAGES = 40
_RENDER_MATRIX = fitz.Matrix(1.25, 1.25)
_MAX_IMAGE_WIDTH = 900


def _page_visual_score(page: fitz.Page) -> int:
    score = 0
    try:
        if page.get_images():
            score += 3
    except Exception:
        pass
    try:
        text = page.get_text().strip()
        if len(text) < 180:
            score += 1
        # Tabular pages often repeat short tokens in grid-like layouts.
        if text.count("\n") >= 6 and len(text.split()) >= 12:
            score += 2
    except Exception:
        pass
    return score


def select_visual_page_indices(
    page_count: int,
    scores: list[int],
    *,
    max_pages: int | None = None,
) -> list[int]:
    """Return page indices to render, preferring visual pages but covering the full deck."""
    ranked = [(score, index) for index, score in enumerate(scores) if score > 0]
    ranked.sort(key=lambda item: (-item[0], item[1]))
    if ranked:
        indices = [index for _, index in ranked]
        missing = [index for index in range(page_count) if index not in indices]
        indices.extend(missing)
    else:
        indices = list(range(page_count))

    cap = max_pages if max_pages is not None else ABSOLUTE_MAX_PAGES
    return indices[:cap]


def compress_image_bytes(data: bytes, *, mime_type: str = "image/png") -> tuple[bytes, str]:
    """Downscale large page renders so vision requests stay fast."""
    try:
        with Image.open(io.BytesIO(data)) as image:
            if image.width <= _MAX_IMAGE_WIDTH:
                return data, mime_type
            ratio = _MAX_IMAGE_WIDTH / image.width
            resized = image.resize(
                (int(image.width * ratio), int(image.height * ratio)),
                Image.Resampling.LANCZOS,
            )
            buffer = io.BytesIO()
            resized.save(buffer, format="JPEG", quality=72, optimize=True)
            return buffer.getvalue(), "image/jpeg"
    except Exception:
        return data, mime_type


def render_pdf_visual_pages(
    file_path: str,
    *,
    max_pages: int | None = None,
) -> list[tuple[int, bytes, str]]:
    path = Path(file_path)
    if not path.is_file():
        return []

    document = fitz.open(str(path))
    try:
        scores = [_page_visual_score(document[i]) for i in range(len(document))]
        indices = select_visual_page_indices(len(document), scores, max_pages=max_pages)
        rendered: list[tuple[int, bytes, str]] = []
        for index in indices:
            pixmap = document[index].get_pixmap(matrix=_RENDER_MATRIX, alpha=False)
            png = pixmap.tobytes("png")
            if len(png) >= 80:
                compressed, mime = compress_image_bytes(png)
                rendered.append((index + 1, compressed, mime))
        return rendered
    finally:
        document.close()
