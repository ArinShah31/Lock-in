from app.ai.chunking.chunker import create_chunks
from app.ai.document.parser import extract_text
from app.ai.vectorstore.service import create_collection, store_chunks


def index_document(
    classroom_id: int,
    document_id: int,
    file_path: str,
):
    create_collection()

    text, _ = extract_text(file_path)

    chunks = create_chunks(
        document_id=str(document_id),
        text=text,
    )

    for chunk in chunks:
        chunk.classroom_id = classroom_id

    store_chunks(chunks)