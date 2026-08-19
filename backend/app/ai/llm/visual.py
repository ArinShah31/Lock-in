"""Multimodal Gemini answers for diagrams and tables in classroom documents."""

from __future__ import annotations

import time

from google.genai import types

from app.ai.guardrails import STUDENT_REFUSAL
from app.ai.llm.client import (
    _chat_models_to_try,
    _is_retryable_gemini_error,
    _is_safety_blocked,
    generate_answer,
    generate_content_with_pool,
)
from app.ai.llm.models import ChatResponse, LlmChatPayload

# Send every page in one vision call for typical classroom PDFs (faster than many batches).
_MAX_PAGES_SINGLE_CALL = 20
_VISION_BATCH_SIZE = 4
_MAX_RETRIES = 3


def _parse_visual_response(response) -> ChatResponse | None:
    if _is_safety_blocked(response):
        return ChatResponse(
            document_answer="",
            additional_explanation="",
            used_document=False,
            used_general_knowledge=False,
            blocked=True,
        )

    parsed = response.parsed
    if parsed is not None:
        payload = (
            parsed
            if isinstance(parsed, LlmChatPayload)
            else LlmChatPayload.model_validate(parsed)
        )
        return ChatResponse(**payload.model_dump(), blocked=False)

    raw = (getattr(response, "text", None) or "").strip()
    if raw:
        payload = LlmChatPayload.model_validate_json(raw)
        return ChatResponse(**payload.model_dump(), blocked=False)
    return None


def _build_visual_prompt(
    question: str,
    text_context: str,
    *,
    batch_note: str = "",
) -> str:
    context_block = (text_context or "").strip()
    context_section = (
        f"\n\n## Extracted text context (supplementary)\n\n{context_block}\n"
        if context_block
        else ""
    )
    batch_section = f"\n{batch_note}\n" if batch_note else ""

    return f"""
You are ASTRA AI, an academic tutor for school students.

The student asked about diagrams, tables, charts, figures, or other visuals in their classroom documents.
You are given page images from those uploaded documents.{context_section}{batch_section}

Rules:
- Explain every relevant diagram, table, chart, or figure you can see in the images.
- For tables: describe headers, important rows, and what the data means.
- For diagrams: explain components, connections, labels, and purpose in clear teaching language.
- Use ONLY what is visible in the images and any supplementary text context above.
- Do not invent visuals or data that are not present.
- If a page has no relevant visual, you may skip it briefly.
- Refuse inappropriate requests with this exact sentence in document_answer:
  {STUDENT_REFUSAL}
- used_general_knowledge must always be false.

Formatting:
- Use Markdown in both fields (headings, bullets, **bold**).
- Use real line breaks, never "\\n".
- Group explanations by page label when helpful.

Return ONLY valid JSON with:
document_answer
additional_explanation
used_document
used_general_knowledge

Set used_document=true when the answer comes from the document images or text context.

## Student question

{question}
"""


def _call_visual_model(prompt: str, images: list[tuple[str, bytes, str]]) -> ChatResponse | None:
    parts: list[object] = []
    for index, (label, data, mime_type) in enumerate(images, start=1):
        parts.append(types.Part.from_bytes(data=data, mime_type=mime_type))
        parts.append(f"Image {index}: {label}")
    parts.append(prompt)

    models = _chat_models_to_try()
    last_exc: Exception | None = None

    for attempt in range(_MAX_RETRIES):
        for model_index, model in enumerate(models):
            try:
                response = generate_content_with_pool(
                    model=model,
                    contents=parts,
                    config=types.GenerateContentConfig(
                        response_mime_type="application/json",
                        response_schema=LlmChatPayload,
                    ),
                )
                parsed = _parse_visual_response(response)
                if parsed is not None:
                    return parsed
            except Exception as exc:
                last_exc = exc
                message = str(exc).upper()
                retryable = _is_retryable_gemini_error(exc) or any(
                    token in message
                    for token in ("503", "UNAVAILABLE", "DEADLINE", "HIGH DEMAND")
                )
                if retryable and attempt < _MAX_RETRIES - 1:
                    wait = 2 ** attempt
                    print(
                        f"[ai] visual retry {attempt + 1}/{_MAX_RETRIES} via {model} in {wait}s: {exc}",
                        flush=True,
                    )
                    time.sleep(wait)
                    break
                if "NOT_FOUND" in message and model_index < len(models) - 1:
                    continue
                print(f"[ai] visual answer failed via {model}: {exc}")

    if last_exc is not None:
        print(f"[ai] visual answer unavailable: {last_exc}")
    return None


def _stitched_batch_response(batch_answers: list[str]) -> ChatResponse:
    body = "\n\n".join(answer.strip() for answer in batch_answers if answer.strip())
    return ChatResponse(
        document_answer=body,
        additional_explanation="",
        used_document=bool(body),
        used_general_knowledge=False,
        blocked=False,
    )


def _merge_batch_answers(question: str, batch_answers: list[str], text_context: str) -> ChatResponse | None:
    combined = "\n\n---\n\n".join(
        f"### Section {index + 1}\n{answer.strip()}"
        for index, answer in enumerate(batch_answers)
        if answer.strip()
    )
    if not combined:
        return None

    context_block = (text_context or "").strip()
    context_section = (
        f"\n\n## Supplementary text context\n\n{context_block}\n"
        if context_block
        else ""
    )

    prompt = f"""
You are ASTRA AI, an academic tutor for school students.

The student asked about diagrams, tables, charts, or figures in their classroom documents.
Below are analyses from sections of the document. Merge them into one clear answer.{context_section}

Rules:
- Cover every diagram and table mentioned across all sections.
- Remove duplicate explanations.
- Keep page references where helpful.
- Use Markdown with headings and bullets.
- used_general_knowledge must always be false.

Return ONLY valid JSON with:
document_answer
additional_explanation
used_document
used_general_knowledge

Set used_document=true.

## Section analyses

{combined}

## Student question

{question}
"""
    merged = generate_answer(prompt)
    if merged is not None and merged.document_answer.strip():
        return merged
    return _stitched_batch_response(batch_answers)


def _process_batches(
    question: str,
    images: list[tuple[str, bytes, str]],
    text_context: str,
) -> ChatResponse | None:
    batch_answers: list[str] = []
    total_batches = (len(images) + _VISION_BATCH_SIZE - 1) // _VISION_BATCH_SIZE
    for batch_index in range(total_batches):
        start = batch_index * _VISION_BATCH_SIZE
        batch = images[start : start + _VISION_BATCH_SIZE]
        batch_note = (
            f"Note: Section {batch_index + 1} of {total_batches} "
            f"(pages {start + 1}–{start + len(batch)})."
        )
        prompt = _build_visual_prompt(question, text_context, batch_note=batch_note)
        print(
            f"[ai] visual batch {batch_index + 1}/{total_batches} ({len(batch)} page(s))",
            flush=True,
        )
        result = _call_visual_model(prompt, batch)
        if result and result.document_answer.strip():
            batch_answers.append(result.document_answer.strip())
            if result.additional_explanation.strip():
                batch_answers.append(result.additional_explanation.strip())

    if not batch_answers:
        return None
    if len(batch_answers) == 1:
        return _stitched_batch_response(batch_answers)
    print(f"[ai] merging {len(batch_answers)} visual section note(s)", flush=True)
    return _merge_batch_answers(question, batch_answers, text_context)


def generate_visual_answer(
    question: str,
    images: list[tuple[str, bytes, str]],
    text_context: str,
) -> ChatResponse | None:
    if not images:
        return None

    if len(images) <= _MAX_PAGES_SINGLE_CALL:
        print(f"[ai] visual single-call analysis ({len(images)} page(s))", flush=True)
        prompt = _build_visual_prompt(
            question,
            text_context,
            batch_note=f"You are given all {len(images)} pages from the document.",
        )
        return _call_visual_model(prompt, images)

    return _process_batches(question, images, text_context)
