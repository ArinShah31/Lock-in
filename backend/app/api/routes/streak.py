from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.core.database import get_db
from app.models.user import User, UserRole
from app.schemas.streak import StreakBreakOut, StudentStreakOut
from app.services.on_time_streak import get_student_on_time_streak

router = APIRouter(tags=["streak"])


@router.get("/me/streak", response_model=StudentStreakOut)
def get_my_streak(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if current_user.role != UserRole.STUDENT:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only students can view streak data",
        )

    streak, last_break = get_student_on_time_streak(db, current_user)
    return StudentStreakOut(
        streak=streak,
        last_break=(
            StreakBreakOut(
                reason=last_break.reason,
                title=last_break.title,
                occurred_at=last_break.occurred_at,
            )
            if last_break
            else None
        ),
    )
