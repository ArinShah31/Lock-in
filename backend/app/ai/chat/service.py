from app.ai.llm.client import generate_answer
from app.ai.llm.models import ChatResponse
from app.ai.retrieval.service import search_classroom


def answer_classroom_question(
    classroom_id: int,
    question: str,
) -> ChatResponse:

    chunks = search_classroom(
        classroom_id=classroom_id,
        question=question,
    )

    context = "\n\n".join(
        chunk.payload["text"]
        for chunk in chunks
    )

    prompt = f"""
You are ASTRA AI.

Return a JSON object matching this schema.

document_answer:
- ONLY information found in the uploaded classroom documents.

additional_explanation:
- Expand the answer using your own educational knowledge only if needed.

used_document:
- true if document_answer contains information.

used_general_knowledge:
- true if additional_explanation is used.

-------------------------

Classroom Documents

{context}

-------------------------

Student Question

{question}
"""

    return generate_answer(prompt)