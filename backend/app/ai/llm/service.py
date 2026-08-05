from app.ai.llm.client import generate_answer
from app.ai.llm.models import ChatResponse


def answer_question(question: str, chunks) -> ChatResponse:
    context = "\n\n".join(
        chunk.payload["text"]
        for chunk in chunks
    )

    prompt = f"""
You are ASTRA AI.

Return a JSON object matching this schema.

document_answer:
- ONLY information found in the uploaded document.

additional_explanation:
- Expand the answer using your own educational knowledge.
- Leave empty if unnecessary.

used_document:
- true if document_answer contains information.

used_general_knowledge:
- true if additional_explanation is used.

-------------------------

Uploaded Document

{context}

-------------------------

Student Question

{question}
"""

    return generate_answer(prompt)