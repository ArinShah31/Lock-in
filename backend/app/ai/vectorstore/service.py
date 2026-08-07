from qdrant_client.http.models import Distance, PointStruct, VectorParams

from app.ai.embeddings.service import embed_text
from app.ai.vectorstore.client import client
from app.core.config import settings

COLLECTION_NAME = settings.qdrant_collection


def create_collection():
    collections = client.get_collections()

    existing = [c.name for c in collections.collections]

    if COLLECTION_NAME in existing:
        return

    client.create_collection(
        collection_name=COLLECTION_NAME,
        vectors_config=VectorParams(
            size=3072,
            distance=Distance.COSINE,
        ),
    )


def store_chunk(chunk):
    vector = embed_text(chunk.text)

    client.upsert(
        collection_name=COLLECTION_NAME,
        points=[
            PointStruct(
                id=chunk.id,
                vector=vector,
                payload={
                    "classroom_id": chunk.classroom_id,
                    "document_id": chunk.document_id,
                    "chunk_index": chunk.index,
                    "text": chunk.text,
                },
            )
        ],
    )


def store_chunks(chunks):
    for chunk in chunks:
        store_chunk(chunk)