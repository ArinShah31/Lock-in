from google import genai

from app.core.config import settings

client = genai.Client(
    api_key=settings.gemini_api_key
)


def generate_embedding(text: str):
    response = client.models.embed_content(
        model=settings.gemini_embedding_model,
        contents=text,
    )

    return response.embeddings[0].values