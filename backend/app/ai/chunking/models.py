from dataclasses import dataclass


@dataclass
class Chunk:
    id: str
    document_id: str
    classroom_id: int | None = None
    index: int = 0
    text: str = ""