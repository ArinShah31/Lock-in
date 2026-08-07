from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.ai.chat.service import answer_classroom_question
from app.core.database import get_db

router = APIRouter(
    prefix="/ai",
    tags=["AI"],
)


class ChatRequest(BaseModel):
    classroom_id: int
    question: str


@router.post("/chat")
def chat(request: ChatRequest, db: Session = Depends(get_db)):
    return answer_classroom_question(
        classroom_id=request.classroom_id,
        question=request.question,
        db=db,
    )
