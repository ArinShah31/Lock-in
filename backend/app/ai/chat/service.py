from sqlalchemy.orm import Session

from app.ai.llm.client import generate_answer
from app.ai.llm.models import ChatResponse
from app.ai.retrieval.document_fallback import fallback_context_chunks
from app.ai.retrieval.service import search_classroom

def _clean_markdown(text: str | None) -> str:
    if not text:
        return ""
    return text.replace("\\n", "\n").strip()


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
You are ASTRA AI, an academic tutor.

Answer the student's question using the Classroom Documents first.

If the uploaded documents fully answer the question:

- Put the document-based answer in document_answer.
- Then provide a richer educational explanation in additional_explanation.

The additional explanation should:
- Help the student understand the concept better.
- Use your own academic knowledge.
- Never contradict the uploaded documents.
- Clearly expand on the topic instead of repeating it.

Formatting rules:

For BOTH fields:
- Use proper Markdown.
- Use headings.
- Use bullet points.
- Use numbered lists where appropriate.
- Use **bold** text for important terms.
- Use real line breaks.
- Never output "\n".

Return ONLY valid JSON with these fields:

document_answer
additional_explanation
used_document
used_general_knowledge

Set:

- used_document=true if document_answer comes from the uploaded documents.
- used_general_knowledge=true if additional_explanation contains information beyond the uploaded documents.

---

## Classroom Documents

{context}

---

## Student Question

{question}

-------------------------
Classroom Documents
{context}
-------------------------

Student Question
{question}
"""

    result = generate_answer(prompt)
    if result is None:
        return _empty_response(
            "I found classroom documents, but could not form an answer just now. Please try again."
        )

    return ChatResponse(
        document_answer=_clean_markdown(result.document_answer),
        additional_explanation=_clean_markdown(result.additional_explanation),
        used_document=bool(result.used_document)
        and bool(_clean_markdown(result.document_answer)),
        used_general_knowledge=bool(result.used_general_knowledge),
    )
