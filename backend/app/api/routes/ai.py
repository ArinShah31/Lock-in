from fastapi import APIRouter
from pydantic import BaseModel

from app.ai.chat.service import answer_classroom_question

router = APIRouter(
    prefix="/ai",
    tags=["AI"],
)


class ChatRequest(BaseModel):
    classroom_id: int
    question: str


@router.post("/chat")
def chat(request: ChatRequest):

    answer = answer_classroom_question(
        classroom_id=request.classroom_id,
        question=request.question,
    )

    return answer