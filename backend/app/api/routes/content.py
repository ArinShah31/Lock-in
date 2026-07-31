from pathlib import Path
import shutil
import uuid

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.models.classroom import Classroom
from app.models.content import ClassroomContent, ContentType
from app.schemas.content import ContentOut

router = APIRouter(
    prefix="/contents",
    tags=["Contents"],
)

UPLOAD_DIR = Path("uploads/contents")
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)


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

    extension = Path(file.filename).suffix
    stored_name = f"{uuid.uuid4()}{extension}"
    destination = UPLOAD_DIR / stored_name

    with destination.open("wb") as buffer:
        shutil.copyfileobj(file.file, buffer)

    size = destination.stat().st_size

    content = ClassroomContent(
        classroom_id=classroom_id,
        uploaded_by=uploaded_by,
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


@router.get("/")
def health_check():
    return {
        "message": "Content module is working!"
    }