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
You are ASTRA AI, an academic assistant.

Return ONLY a valid JSON object with this exact schema.

document_answer:
- Answer ONLY using information from the uploaded classroom documents.
- Format the answer using Markdown.
- Use headings, numbered lists, bullet points, and bold text where appropriate.
- Use REAL line breaks.
- NEVER output the literal characters "\\n".

additional_explanation:
- If helpful, expand the answer using your own educational knowledge.
- Also format this field using Markdown.

used_document:
- true if the answer contains information from the documents.

used_general_knowledge:
- true if additional_explanation contains information beyond the documents.

-------------------------
Classroom Documents
-------------------------

{context}

-------------------------
Student Question
-------------------------

{question}
"""

    return generate_answer(prompt)