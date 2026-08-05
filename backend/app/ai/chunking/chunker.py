from uuid import uuid4

from app.ai.chunking.models import Chunk


def create_chunks(
    document_id: str,
    text: str,
    chunk_size: int = 800,
    overlap: int = 150,
) -> list[Chunk]:
    """
    Split text into fixed-size overlapping chunks.
    """

    text = text.strip()

    if not text:
        return []

    chunks = []

    start = 0
    index = 1

    while start < len(text):
        end = start + chunk_size

        chunk_text = text[start:end].strip()

        if chunk_text:
            chunks.append(
                Chunk(
                    id=str(uuid4()),
                    document_id=document_id,
                    index=index,
                    text=chunk_text,
                )
            )

            index += 1

        start += chunk_size - overlap

    return chunks