from pathlib import Path
import shutil
import uuid

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.core.database import get_db
from app.models.classroom import Classroom
from app.models.content import ClassroomContent, ContentType
from app.models.user import User
from app.schemas.content import ContentOut, ContentUpdate
from app.ai.indexing.service import index_document

router = APIRouter(
    prefix="/contents",
    tags=["Contents"],
)

UPLOAD_DIR = Path("uploads/contents")
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)


def _get_classroom_or_404(db: Session, classroom_id: int) -> Classroom:
    classroom = db.query(Classroom).filter(Classroom.id == classroom_id).first()
    if classroom is None:
        raise HTTPException(status_code=404, detail="Classroom not found")
    return classroom


def _ensure_class_teacher(user: User, classroom: Classroom) -> None:
    if classroom.class_teacher_id != user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only the class teacher can manage classroom documents",
        )


@router.post(
    "/classrooms/{classroom_id}",
    response_model=ContentOut,
)
async def upload_content(
    classroom_id: int,
    title: str = Form(...),
    description: str | None = Form(None),
    content_type: ContentType = Form(...),
    uploaded_by: int = Form(...),
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    classroom = _get_classroom_or_404(db, classroom_id)
    _ensure_class_teacher(current_user, classroom)

    extension = Path(file.filename).suffix
    stored_name = f"{uuid.uuid4()}{extension}"
    destination = UPLOAD_DIR / stored_name

    with destination.open("wb") as buffer:
        shutil.copyfileobj(file.file, buffer)

    size = destination.stat().st_size

    content = ClassroomContent(
        classroom_id=classroom_id,
        uploaded_by=current_user.id,
        title=title,
        description=description,
        content_type=content_type,
        file_name=file.filename,
        stored_name=stored_name,
        file_path=str(destination),
        file_size=size,
        mime_type=file.content_type or "application/octet-stream",
    )

    db.add(content)
    db.commit()
    db.refresh(content)

    print("Starting AI indexing...")

    try:
        index_document(
            classroom_id=classroom.id,
            document_id=content.id,
            file_path=content.file_path,
        )
        print("AI indexing finished.")
    except Exception as e:
        print(f"AI indexing failed: {e}")

    return content


@router.get(
    "/classrooms/{classroom_id}",
    response_model=list[ContentOut],
)
def get_classroom_contents(
    classroom_id: int,
    db: Session = Depends(get_db),
):
    classroom = (
        db.query(Classroom)
        .filter(Classroom.id == classroom_id)
        .first()
    )

    if classroom is None:
        raise HTTPException(
            status_code=404,
            detail="Classroom not found",
        )

    contents = (
        db.query(ClassroomContent)
        .filter(
            ClassroomContent.classroom_id == classroom_id,
            ClassroomContent.is_active == True,
        )
        .order_by(ClassroomContent.created_at.desc())
        .all()
    )

    return contents

@router.patch("/{content_id}", response_model=ContentOut)
def update_content(
    content_id: int,
    payload: ContentUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    content = (
        db.query(ClassroomContent)
        .filter(ClassroomContent.id == content_id)
        .first()
    )

    if content is None:
        raise HTTPException(
            status_code=404,
            detail="Document not found",
        )

    classroom = _get_classroom_or_404(db, content.classroom_id)
    _ensure_class_teacher(current_user, classroom)

    update_data = payload.model_dump(exclude_unset=True)

    for field, value in update_data.items():
        setattr(content, field, value)

    db.commit()
    db.refresh(content)

    return content

@router.delete("/classrooms/{classroom_id}/{content_id}")
def delete_content(
    classroom_id: int,
    content_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    classroom = _get_classroom_or_404(db, classroom_id)
    _ensure_class_teacher(current_user, classroom)

    content = (
        db.query(ClassroomContent)
        .filter(
            ClassroomContent.id == content_id,
            ClassroomContent.classroom_id == classroom_id,
        )
        .first()
    )

    if content is None:
        raise HTTPException(
            status_code=404,
            detail="Document not found",
        )

    file_path = Path(content.file_path)

    if file_path.exists():
        file_path.unlink()

    db.delete(content)
    db.commit()

    return {"message": "Document deleted successfully"}


@router.get("/")
def health_check():
    return {
        "message": "Content module is working!"
    }