from sqlalchemy.orm import Session

from app.ai.llm.client import generate_answer
from app.ai.llm.models import ChatResponse
from app.ai.retrieval.document_fallback import fallback_context_chunks
from app.ai.retrieval.service import search_classroom


def _empty_response(message: str) -> ChatResponse:
    return ChatResponse(
        document_answer=message,
        additional_explanation="",
        used_document=False,
        used_general_knowledge=False,
    )


def answer_classroom_question(
    classroom_id: int,
    question: str,
    db: Session | None = None,
) -> ChatResponse:
    context_parts: list[str] = []

    chunks = search_classroom(
        classroom_id=classroom_id,
        question=question,
    )
    for chunk in chunks:
        payload = getattr(chunk, "payload", None) or {}
        text = payload.get("text")
        if text and str(text).strip():
            context_parts.append(str(text).strip())

    if not context_parts and db is not None:
        print(
            f"Vector retrieval empty for classroom {classroom_id}; "
            "using uploaded-document text fallback."
        )
        context_parts = fallback_context_chunks(db, classroom_id, question)

    if not context_parts:
        return _empty_response(
            "I could not find usable text in this classroom’s uploaded documents "
            "for that question. Make sure PDFs are uploaded on the Documents tab, "
            "then ask about a topic covered in those files."
        )

    context = "\n\n---\n\n".join(context_parts)

    prompt = f"""
You are ASTRA AI, an academic assistant.

Return ONLY a valid JSON object with this exact schema.

document_answer:

- Answer ONLY using information from the uploaded classroom documents.
- Format the answer using Markdown.
- Use headings, numbered lists, bullet points, and **bold text** where appropriate.
- Use REAL line breaks.
- NEVER output the literal characters "\n".

additional_explanation:

- If helpful, expand the answer using your own educational knowledge.
- Also format this field using Markdown.

used_document:

- true if the answer contains information from the documents.

used_general_knowledge:

- true if additional_explanation contains information beyond the documents.

---

## Classroom Documents

{context}
{question}
"""

    result = generate_answer(prompt)
    if result is None:
        return _empty_response(
            "I found classroom documents, but could not form an answer just now. Please try again."
        )

    # Never surface invented "extra" knowledge to the student UI.
    return ChatResponse(
        document_answer=(result.document_answer or "").strip(),
        additional_explanation="",
        used_document=bool(result.used_document) and bool((result.document_answer or "").strip()),
        used_general_knowledge=False,
    )
