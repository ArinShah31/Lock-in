from qdrant_client.http.models import FieldCondition, Filter, MatchValue

from app.ai.embeddings.service import embed_text
from app.ai.vectorstore.client import client
from app.ai.vectorstore.service import COLLECTION_NAME

MIN_RELEVANCE_SCORE = 0.35


def search_classroom(
    classroom_id: int,
    question: str,
    limit: int = 5,
    min_score: float = MIN_RELEVANCE_SCORE,
):
    try:
        question_vector = embed_text(question)

        results = client.query_points(
            collection_name=COLLECTION_NAME,
            query=question_vector,
            limit=limit,
            query_filter=Filter(
                must=[
                    FieldCondition(
                        key="classroom_id",
                        match=MatchValue(value=classroom_id),
                    )
                ]
            ),
        )

        points = results.points or []
        if min_score <= 0:
            return points
        return [point for point in points if (getattr(point, "score", None) or 0) >= min_score]
    except Exception as e:
        print("Vector search notice (Qdrant offline or empty):", e)
        return []
