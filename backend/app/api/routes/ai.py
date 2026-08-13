from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.ai.chat.service import answer_classroom_question
from app.ai.guardrails import validate_question_length
from app.ai.teacher_chat.service import answer_teacher_question
from app.api.deps import get_current_user, require_roles
from app.api.routes.classrooms import (
    TEACHER_ROLES,
    _ensure_view_access,
    _get_classroom_or_404,
)
from app.core.database import get_db
from app.models.user import User, UserRole

router = APIRouter(
    prefix="/ai",
    tags=["AI"],
)


class ChatRequest(BaseModel):
    classroom_id: int
    question: str = Field(min_length=1, max_length=4000)


class TeacherChatRequest(BaseModel):
    question: str = Field(min_length=1, max_length=4000)
    classroom_id: int | None = None


@router.post("/chat")
def chat(
    request: ChatRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    length_error = validate_question_length(request.question)
    if length_error:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=length_error)

    classroom = _get_classroom_or_404(db, request.classroom_id)
    _ensure_view_access(db, current_user, classroom)

    return answer_classroom_question(
        classroom_id=request.classroom_id,
        question=request.question,
        db=db,
    )


@router.post("/teacher-chat")
def teacher_chat(
    request: TeacherChatRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(
        require_roles([UserRole.SUPER_ADMIN, *TEACHER_ROLES])
    ),
):
    length_error = validate_question_length(request.question)
    if length_error:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=length_error)

    return answer_teacher_question(
        db=db,
        user=current_user,
        question=request.question,
        classroom_id=request.classroom_id,
    )
