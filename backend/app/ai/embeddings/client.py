from google import genai
from app.core.config import settings


def get_client():
    api_key = settings.gemini_api_key or "DUMMY_KEY"
    return genai.Client(api_key=api_key)


def generate_embedding(text: str):
    client = get_client()
    response = client.models.embed_content(
        model=settings.gemini_embedding_model,
        contents=text,
    )

    return response.embeddings[0].values