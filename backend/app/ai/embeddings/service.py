from app.ai.embeddings.client import generate_embedding


def embed_text(text: str):
    return generate_embedding(text)