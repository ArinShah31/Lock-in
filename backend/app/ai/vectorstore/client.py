from qdrant_client import QdrantClient
from app.core.config import settings


def get_qdrant_client():
    try:
        return QdrantClient(
            host=settings.qdrant_host,
            port=settings.qdrant_port,
        )
    except Exception as e:
        print("Qdrant connection warning:", e)
        return None


class LazyClientProxy:
    def __getattr__(self, name):
        c = get_qdrant_client()
        if c is None:
            raise RuntimeError("Qdrant database connection failed")
        return getattr(c, name)


client = LazyClientProxy()