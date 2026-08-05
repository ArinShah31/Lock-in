from dataclasses import dataclass


@dataclass
class VectorChunk:
    id: str
    classroom_id: int
    document_id: int
    chunk_index: int
    text: str
    embedding: list[float]