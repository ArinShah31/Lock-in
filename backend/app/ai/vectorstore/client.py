from pathlib import Path

from qdrant_client import QdrantClient

from app.core.config import settings

_client: QdrantClient | None = None


def get_qdrant_client() -> QdrantClient | None:
    global _client
    if _client is not None:
        return _client

    try:
        path = (settings.qdrant_path or "").strip()
        if path:
            storage = Path(path)
            storage.mkdir(parents=True, exist_ok=True)
            _client = QdrantClient(path=str(storage.resolve()))
        else:
            _client = QdrantClient(
                host=settings.qdrant_host,
                port=settings.qdrant_port,
            )
        return _client
    except Exception as e:
        print("Qdrant connection warning:", e)
        _client = None
        return None


class LazyClientProxy:
    def __getattr__(self, name):
        c = get_qdrant_client()
        if c is None:
            raise RuntimeError("Qdrant database connection failed")
        return getattr(c, name)


client = LazyClientProxy()
