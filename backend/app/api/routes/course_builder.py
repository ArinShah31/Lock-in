import re
from datetime import datetime, timezone
from pathlib import Path

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.core.config import settings
from app.core.database import get_db
from app.models.classroom import Classroom, ClassroomStudent, ClassroomTeacher
from app.models.course_builder import CourseArtifact, CourseBuildJob, CourseChapterAttempt, CourseChapterLock
from app.models.subject import Subject
from app.models.user import User, UserRole
from app.schemas.course_builder import (
    ArtifactType,
    AttemptOut,
    ChapterLockUpdate,
    ChapterNotesContent,
    ChapterNotesOut,
    ChapterNotesStatus,
    CourseArtifactOut,
    CourseArtifactUpdate,
    CourseBuildJobOut,
    GenerateCourseRequest,
    LearningChapterOut,
    LearningPathOut,
    QuizAttemptCreate,
)
from app.schemas.subject import SubjectOut
from app.services.course_builder import (
    CHAPTER_NOTES_META_PREFIX,
    _ensure_chapter_locks,
    assemble_chapters_from_artifacts,
    fail_stuck_running_jobs,
    find_active_notes_job,
    find_chapter_notes_artifact,
    find_latest_failed_notes_job,
    start_course_builder_job,
    sync_chapter_notes_publish_state,
)

router = APIRouter(tags=["course-builder"])


def _get_subject_or_404(db: Session, subject_id: int) -> Subject:
    subject = db.query(Subject).filter(Subject.id == subject_id, Subject.is_active.is_(True)).first()
    if not subject:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Subject not found")
    return subject


def _get_classroom_or_404(db: Session, classroom_id: int) -> Classroom:
    classroom = db.query(Classroom).filter(Classroom.id == classroom_id, Classroom.is_active.is_(True)).first()
    if not classroom:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Classroom not found")
    return classroom


def _user_can_view_classroom(db: Session, user: User, classroom: Classroom) -> bool:
    if user.role == UserRole.SUPER_ADMIN:
        return True
    if user.institution_id != classroom.institution_id:
        return False
    if user.role == UserRole.HOD:
        return classroom.department_id is None or user.department_id in (None, classroom.department_id)
    if user.role == UserRole.CLASS_TEACHER:
        return classroom.class_teacher_id == user.id
    if user.role == UserRole.SUBJECT_TEACHER:
        return (
            db.query(ClassroomTeacher)
            .filter(
                ClassroomTeacher.classroom_id == classroom.id,
                ClassroomTeacher.teacher_id == user.id,
                ClassroomTeacher.is_active.is_(True),
            )
            .first()
            is not None
        )
    if user.role == UserRole.STUDENT:
        return (
            db.query(ClassroomStudent)
            .filter(
                ClassroomStudent.classroom_id == classroom.id,
                ClassroomStudent.student_id == user.id,
                ClassroomStudent.is_active.is_(True),
            )
            .first()
            is not None
        )
    return False


def _user_can_edit_subject(user: User, subject: Subject, classroom: Classroom) -> bool:
    if user.role == UserRole.SUPER_ADMIN:
        return True
    if user.role == UserRole.CLASS_TEACHER and classroom.class_teacher_id == user.id:
        return True
    return user.role == UserRole.SUBJECT_TEACHER and subject.teacher_id == user.id


def _ensure_subject_view_access(db: Session, user: User, subject: Subject, classroom: Classroom) -> None:
    if user.role == UserRole.SUBJECT_TEACHER and subject.teacher_id == user.id:
        return
    if not _user_can_view_classroom(db, user, classroom):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="No access to this subject")
    if user.role == UserRole.STUDENT and not subject.is_published:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Subject is not published")


def _ensure_subject_edit_access(user: User, subject: Subject, classroom: Classroom) -> None:
    if not _user_can_edit_subject(user, subject, classroom):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Cannot manage AI course builder")


def _latest_learning_artifact(db: Session, subject_id: int, *, published_only: bool) -> CourseArtifact | None:
    query = db.query(CourseArtifact).filter(
        CourseArtifact.subject_id == subject_id,
        CourseArtifact.is_active.is_(True),
        CourseArtifact.artifact_type.in_(
            [
                ArtifactType.LEARNING_PATH.value,
                ArtifactType.ROADMAP.value,
                ArtifactType.FLASHCARDS.value,
                ArtifactType.QUIZ.value,
                ArtifactType.ASSESSMENT.value,
            ]
        ),
    )
    if published_only:
        query = query.filter(CourseArtifact.is_published.is_(True))
    return query.order_by(CourseArtifact.id.desc()).first()


@router.post("/subjects/{subject_id}/course-builder/upload-syllabus", response_model=SubjectOut)
async def upload_syllabus(
    subject_id: int,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    subject = _get_subject_or_404(db, subject_id)
    classroom = _get_classroom_or_404(db, subject.classroom_id)
    _ensure_subject_edit_access(current_user, subject, classroom)

    upload_dir = Path(settings.uploads_dir) / "syllabi"
    upload_dir.mkdir(parents=True, exist_ok=True)
    safe_name = re.sub(r"[^a-zA-Z0-9._-]+", "_", file.filename or "syllabus.txt")
    file_path = upload_dir / f"{subject_id}_{int(datetime.now(timezone.utc).timestamp())}_{safe_name}"
    content = await file.read()
    file_path.write_bytes(content)

    subject.syllabus_file_url = str(file_path)
    if file.content_type and (file.content_type.startswith("text/") or safe_name.endswith((".txt", ".md"))):
        subject.syllabus_text = content.decode("utf-8", errors="ignore")

    db.commit()
    db.refresh(subject)
    return subject


@router.post(
    "/subjects/{subject_id}/course-builder/generate",
    response_model=CourseBuildJobOut,
    status_code=status.HTTP_202_ACCEPTED,
)
def generate_course_builder_artifacts(
    subject_id: int,
    payload: GenerateCourseRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    subject = _get_subject_or_404(db, subject_id)
    classroom = _get_classroom_or_404(db, subject.classroom_id)
    _ensure_subject_edit_access(current_user, subject, classroom)

    types = payload.artifact_types or [ArtifactType.LEARNING_PATH]
    if not subject.syllabus_text and not subject.syllabus_file_url:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Add syllabus text or upload a syllabus file first",
        )

    provider = settings.ai_provider.lower().strip()
    if provider == "gemini" and not settings.resolve_gemini_api_keys():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                "Real AI generation needs GEMINI_API_KEY in backend/.env. "
                "Get a free key from https://aistudio.google.com/apikey then restart the backend."
            ),
        )
    if provider == "groq" and not settings.groq_api_key.strip():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                "Real AI generation needs GROQ_API_KEY in backend/.env. "
                "Get a free key from https://console.groq.com/keys then restart the backend."
            ),
        )

    fail_stuck_running_jobs(older_than_minutes=8)

    job = CourseBuildJob(
        subject_id=subject.id,
        created_by_id=current_user.id,
        status="PENDING",
        requested_artifacts=[item.value for item in types],
        syllabus_text=subject.syllabus_text,
        syllabus_file_url=subject.syllabus_file_url,
    )
    db.add(job)
    db.commit()
    db.refresh(job)
    start_course_builder_job(job.id)
    return job


@router.get("/subjects/{subject_id}/course-builder/jobs/{job_id}", response_model=CourseBuildJobOut)
def get_course_builder_job(
    subject_id: int,
    job_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    subject = _get_subject_or_404(db, subject_id)
    classroom = _get_classroom_or_404(db, subject.classroom_id)
    _ensure_subject_edit_access(current_user, subject, classroom)

    fail_stuck_running_jobs(older_than_minutes=8)
    db.expire_all()

    job = (
        db.query(CourseBuildJob)
        .filter(CourseBuildJob.id == job_id, CourseBuildJob.subject_id == subject_id)
        .first()
    )
    if not job:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Generation job not found")
    return job


@router.get("/subjects/{subject_id}/course-builder/artifacts", response_model=list[CourseArtifactOut])
def list_course_artifacts(
    subject_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    subject = _get_subject_or_404(db, subject_id)
    classroom = _get_classroom_or_404(db, subject.classroom_id)
    _ensure_subject_view_access(db, current_user, subject, classroom)

    query = db.query(CourseArtifact).filter(
        CourseArtifact.subject_id == subject_id,
        CourseArtifact.is_active.is_(True),
    )
    if not _user_can_edit_subject(current_user, subject, classroom):
        query = query.filter(CourseArtifact.is_published.is_(True))

    latest_by_type: dict[str, CourseArtifact] = {}
    for artifact in query.order_by(CourseArtifact.id.desc()).all():
        if artifact.artifact_type not in latest_by_type:
            latest_by_type[artifact.artifact_type] = artifact
    order = ["LEARNING_PATH", "ROADMAP", "FLASHCARDS", "QUIZ", "ASSESSMENT"]
    return [latest_by_type[key] for key in order if key in latest_by_type]


@router.patch("/course-builder/artifacts/{artifact_id}", response_model=CourseArtifactOut)
def update_course_artifact(
    artifact_id: int,
    payload: CourseArtifactUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    artifact = db.query(CourseArtifact).filter(CourseArtifact.id == artifact_id, CourseArtifact.is_active.is_(True)).first()
    if not artifact:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Course artifact not found")

    subject = _get_subject_or_404(db, artifact.subject_id)
    classroom = _get_classroom_or_404(db, subject.classroom_id)
    _ensure_subject_edit_access(current_user, subject, classroom)

    updates = payload.model_dump(exclude_unset=True)
    for field, value in updates.items():
        setattr(artifact, field, value)

    if updates.get("is_published") is True:
        chapters = assemble_chapters_from_artifacts([artifact])
        _ensure_chapter_locks(db, subject.id, [c.chapter for c in chapters], current_user.id)

    if artifact.artifact_type == ArtifactType.LEARNING_PATH.value and "is_published" in updates:
        sync_chapter_notes_publish_state(db, subject.id, bool(updates["is_published"]))

    db.commit()
    db.refresh(artifact)
    return artifact


@router.get("/subjects/{subject_id}/course-builder/learning-path", response_model=LearningPathOut)
def get_learning_path(
    subject_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    subject = _get_subject_or_404(db, subject_id)
    classroom = _get_classroom_or_404(db, subject.classroom_id)
    _ensure_subject_view_access(db, current_user, subject, classroom)

    can_edit = _user_can_edit_subject(current_user, subject, classroom)
    artifacts = (
        db.query(CourseArtifact)
        .filter(CourseArtifact.subject_id == subject_id, CourseArtifact.is_active.is_(True))
        .order_by(CourseArtifact.id.desc())
        .all()
    )
    if not can_edit:
        artifacts = [a for a in artifacts if a.is_published]

    chapters = assemble_chapters_from_artifacts(artifacts)
    if not chapters:
        return LearningPathOut(
            subject_id=subject_id,
            artifact_id=None,
            is_published=False,
            current_chapter=1,
            chapters=[],
        )

    _ensure_chapter_locks(db, subject_id, [c.chapter for c in chapters], current_user.id)
    db.commit()

    locks = {
        row.chapter_number: row.is_unlocked
        for row in db.query(CourseChapterLock).filter(CourseChapterLock.subject_id == subject_id).all()
    }
    for number in [c.chapter for c in chapters]:
        locks.setdefault(number, number == 1)

    unlocked_numbers = [n for n, unlocked in locks.items() if unlocked]
    current_chapter = max(unlocked_numbers) if unlocked_numbers else 1

    learning_artifact = next(
        (a for a in artifacts if a.artifact_type == ArtifactType.LEARNING_PATH.value),
        artifacts[0] if artifacts else None,
    )

    out_chapters: list[LearningChapterOut] = []
    for chapter in chapters:
        unlocked = bool(locks.get(chapter.chapter, chapter.chapter == 1))
        locked_for_viewer = (not can_edit) and (not unlocked)
        if locked_for_viewer:
            out_chapters.append(
                LearningChapterOut(
                    chapter=chapter.chapter,
                    title=chapter.title,
                    summary=None,
                    timeline=chapter.timeline,
                    is_unlocked=False,
                    is_current=chapter.chapter == current_chapter,
                    is_locked_for_viewer=True,
                )
            )
        else:
            out_chapters.append(
                LearningChapterOut(
                    chapter=chapter.chapter,
                    title=chapter.title,
                    summary=chapter.summary,
                    timeline=chapter.timeline,
                    objectives=chapter.objectives,
                    topics=chapter.topics,
                    activities=chapter.activities,
                    flashcards=chapter.flashcards,
                    quiz=chapter.quiz,
                    assessment=None,
                    is_unlocked=unlocked,
                    is_current=chapter.chapter == current_chapter,
                    is_locked_for_viewer=False,
                )
            )

    return LearningPathOut(
        subject_id=subject_id,
        artifact_id=learning_artifact.id if learning_artifact else None,
        is_published=bool(learning_artifact and learning_artifact.is_published),
        current_chapter=current_chapter,
        chapters=out_chapters,
    )


@router.get(
    "/subjects/{subject_id}/course-builder/chapters/{chapter_number}/notes",
    response_model=ChapterNotesOut,
)
def get_chapter_notes(
    subject_id: int,
    chapter_number: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    subject = _get_subject_or_404(db, subject_id)
    classroom = _get_classroom_or_404(db, subject.classroom_id)
    _ensure_subject_view_access(db, current_user, subject, classroom)

    can_edit = _user_can_edit_subject(current_user, subject, classroom)
    artifacts = (
        db.query(CourseArtifact)
        .filter(CourseArtifact.subject_id == subject_id, CourseArtifact.is_active.is_(True))
        .order_by(CourseArtifact.id.desc())
        .all()
    )
    if not can_edit:
        artifacts = [a for a in artifacts if a.is_published]

    chapters = assemble_chapters_from_artifacts(artifacts)
    chapter = next((c for c in chapters if c.chapter == chapter_number), None)
    if not chapter:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Chapter not found on learning path")

    lock = (
        db.query(CourseChapterLock)
        .filter(
            CourseChapterLock.subject_id == subject_id,
            CourseChapterLock.chapter_number == chapter_number,
        )
        .first()
    )
    unlocked = bool(lock.is_unlocked) if lock else chapter_number == 1
    locked_for_viewer = (not can_edit) and (not unlocked)

    if locked_for_viewer:
        return ChapterNotesOut(
            subject_id=subject_id,
            chapter=chapter_number,
            chapter_title=chapter.title,
            status=ChapterNotesStatus.MISSING,
            is_unlocked=False,
            is_locked_for_viewer=True,
        )

    active_job = find_active_notes_job(db, subject_id, chapter_number)
    if active_job:
        return ChapterNotesOut(
            subject_id=subject_id,
            chapter=chapter_number,
            chapter_title=chapter.title,
            status=ChapterNotesStatus.GENERATING,
            job_id=active_job.id,
            is_unlocked=unlocked,
            is_locked_for_viewer=False,
        )

    notes_artifact = find_chapter_notes_artifact(
        db,
        subject_id,
        chapter_number,
        published_only=not can_edit,
    )
    if notes_artifact and isinstance(notes_artifact.content, dict):
        content = ChapterNotesContent.model_validate(notes_artifact.content)
        return ChapterNotesOut(
            subject_id=subject_id,
            chapter=content.chapter,
            chapter_title=content.chapter_title,
            status=ChapterNotesStatus.READY,
            intro=content.intro,
            lessons=content.lessons,
            artifact_id=notes_artifact.id,
            job_id=notes_artifact.job_id,
            is_published=notes_artifact.is_published,
            is_unlocked=unlocked,
            is_locked_for_viewer=False,
        )

    failed_job = find_latest_failed_notes_job(db, subject_id, chapter_number) if can_edit else None
    if failed_job:
        return ChapterNotesOut(
            subject_id=subject_id,
            chapter=chapter_number,
            chapter_title=chapter.title,
            status=ChapterNotesStatus.FAILED,
            job_id=failed_job.id,
            is_unlocked=unlocked,
            is_locked_for_viewer=False,
            error_message=failed_job.error_message,
        )

    return ChapterNotesOut(
        subject_id=subject_id,
        chapter=chapter_number,
        chapter_title=chapter.title,
        status=ChapterNotesStatus.MISSING,
        is_unlocked=unlocked,
        is_locked_for_viewer=False,
    )


@router.post(
    "/subjects/{subject_id}/course-builder/chapters/{chapter_number}/notes/generate",
    response_model=CourseBuildJobOut,
    status_code=status.HTTP_202_ACCEPTED,
)
def generate_chapter_notes(
    subject_id: int,
    chapter_number: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    subject = _get_subject_or_404(db, subject_id)
    classroom = _get_classroom_or_404(db, subject.classroom_id)
    _ensure_subject_edit_access(current_user, subject, classroom)

    if not subject.syllabus_text and not subject.syllabus_file_url:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Add syllabus text or upload a syllabus file first",
        )

    provider = settings.ai_provider.lower().strip()
    if provider == "gemini" and not settings.resolve_gemini_api_keys():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                "Real AI generation needs GEMINI_API_KEY in backend/.env. "
                "Get a free key from https://aistudio.google.com/apikey then restart the backend."
            ),
        )
    if provider == "groq" and not settings.groq_api_key.strip():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                "Real AI generation needs GROQ_API_KEY in backend/.env. "
                "Get a free key from https://console.groq.com/keys then restart the backend."
            ),
        )

    artifacts = (
        db.query(CourseArtifact)
        .filter(CourseArtifact.subject_id == subject_id, CourseArtifact.is_active.is_(True))
        .order_by(CourseArtifact.id.desc())
        .all()
    )
    chapter = next(
        (c for c in assemble_chapters_from_artifacts(artifacts) if c.chapter == chapter_number),
        None,
    )
    if not chapter:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Chapter not found. Generate the learning path first.",
        )

    existing_job = find_active_notes_job(db, subject_id, chapter_number)
    if existing_job:
        return existing_job

    job = CourseBuildJob(
        subject_id=subject.id,
        created_by_id=current_user.id,
        status="PENDING",
        requested_artifacts=[
            ArtifactType.CHAPTER_NOTES.value,
            f"{CHAPTER_NOTES_META_PREFIX}{chapter_number}",
        ],
        syllabus_text=subject.syllabus_text,
        syllabus_file_url=subject.syllabus_file_url,
    )
    db.add(job)
    db.commit()
    db.refresh(job)
    start_course_builder_job(job.id)
    return job


@router.patch(
    "/subjects/{subject_id}/course-builder/chapters/{chapter_number}/lock",
    response_model=LearningPathOut,
)
def set_chapter_lock(
    subject_id: int,
    chapter_number: int,
    payload: ChapterLockUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    subject = _get_subject_or_404(db, subject_id)
    classroom = _get_classroom_or_404(db, subject.classroom_id)
    _ensure_subject_edit_access(current_user, subject, classroom)

    if chapter_number < 1:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid chapter number")

    if chapter_number == 1 and payload.is_unlocked is False:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Chapter 1 must stay unlocked")

    lock = (
        db.query(CourseChapterLock)
        .filter(
            CourseChapterLock.subject_id == subject_id,
            CourseChapterLock.chapter_number == chapter_number,
        )
        .first()
    )
    if not lock:
        lock = CourseChapterLock(
            subject_id=subject_id,
            chapter_number=chapter_number,
            is_unlocked=payload.is_unlocked,
            updated_by_id=current_user.id,
        )
        db.add(lock)
    else:
        lock.is_unlocked = payload.is_unlocked
        lock.updated_by_id = current_user.id

    db.commit()
    return get_learning_path(subject_id=subject_id, db=db, current_user=current_user)


@router.post(
    "/subjects/{subject_id}/course-builder/chapters/{chapter_number}/quiz-attempt",
    response_model=AttemptOut,
    status_code=status.HTTP_201_CREATED,
)
def submit_quiz_attempt(
    subject_id: int,
    chapter_number: int,
    payload: QuizAttemptCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    subject = _get_subject_or_404(db, subject_id)
    classroom = _get_classroom_or_404(db, subject.classroom_id)
    _ensure_subject_view_access(db, current_user, subject, classroom)

    path = get_learning_path(subject_id=subject_id, db=db, current_user=current_user)
    chapter = next((c for c in path.chapters if c.chapter == chapter_number), None)
    if not chapter or chapter.is_locked_for_viewer:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Chapter is locked")

    correct = 0
    total = len(chapter.quiz)
    for index, question in enumerate(chapter.quiz):
        selected = payload.selected_answers[index] if index < len(payload.selected_answers) else None
        if selected == question.correct_answer:
            correct += 1
    score = (correct / total * 100.0) if total else 0.0

    attempt = CourseChapterAttempt(
        subject_id=subject_id,
        chapter_number=chapter_number,
        user_id=current_user.id,
        attempt_type="QUIZ",
        score=score,
        payload={"selected_answers": payload.selected_answers, "correct": correct, "total": total},
    )
    db.add(attempt)
    db.commit()
    db.refresh(attempt)
    return attempt
