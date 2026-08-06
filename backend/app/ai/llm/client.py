from google import genai
from app.ai.llm.models import ChatResponse
from app.core.config import settings


def get_client():
    api_key = settings.gemini_api_key or "DUMMY_KEY"
    return genai.Client(api_key=api_key)


def generate_answer(prompt: str) -> ChatResponse:
    client = get_client()
    response = client.models.generate_content(
        model=settings.gemini_chat_model,
        contents=prompt,
        config={
            "response_mime_type": "application/json",
            "response_schema": ChatResponse,
        },
    )

    return response.parsed