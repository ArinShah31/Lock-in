import threading
from datetime import datetime, timezone

from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.database import SessionLocal
from app.models.course_builder import CourseArtifact, CourseBuildJob, CourseChapterLock
from app.models.subject import Subject
from app.schemas.course_builder import ArtifactType, ChapterContent, ChapterNotesContent, CourseBuilderOutput
from app.services.ai.gemini_provider import GeminiCourseBuilderProvider
from app.services.ai.groq_provider import GroqCourseBuilderProvider
from app.services.ai.mock_provider import MockCourseBuilderProvider
from app.services.ai.provider import CourseBuilderProvider

CHAPTER_NOTES_META_PREFIX = "CHAPTER:"


def get_course_builder_provider() -> CourseBuilderProvider:
    provider = settings.ai_provider.lower().strip()
    if provider == "mock":
        return MockCourseBuilderProvider()
    if provider == "gemini":
        keys = settings.resolve_gemini_api_keys()
        if not keys:
            raise RuntimeError(
                "GEMINI_API_KEY is missing. Add it to backend/.env to generate real syllabus-based content. "
                "Get a free key at https://aistudio.google.com/apikey"
            )
        return GeminiCourseBuilderProvider(keys, settings.gemini_model)
    if provider == "groq":
        key = settings.groq_api_key.strip()
        if not key:
            raise RuntimeError(
                "GROQ_API_KEY is missing. Add it to backend/.env for free real AI generation. "
                "Get a free key at https://console.groq.com/keys"
            )
        return GroqCourseBuilderProvider(key, settings.groq_model)
    raise RuntimeError(
        f"Unsupported AI_PROVIDER '{settings.ai_provider}'. Use 'gemini', 'groq', or 'mock'."
    )


def start_course_builder_job(job_id: int) -> None:
    """Run generation in an isolated daemon thread so HTTP requests stay responsive."""
    thread = threading.Thread(
        target=run_course_builder_job,
        args=(job_id,),
        daemon=True,
        name=f"course-builder-job-{job_id}",
    )
    thread.start()


def run_course_builder_job(job_id: int) -> None:
    db = SessionLocal()
    try:
        _run_course_builder_job(db, job_id)
    finally:
        db.close()


def set_job_progress(job_id: int, message: str) -> None:
    db = SessionLocal()
    try:
        job = db.query(CourseBuildJob).filter(CourseBuildJob.id == job_id).first()
        if not job or job.status != "RUNNING":
            return
        job.error_message = message
        job.updated_at = datetime.now(timezone.utc)
        db.commit()
    finally:
        db.close()


def fail_stuck_running_jobs(*, older_than_minutes: int = 8) -> int:
    """Mark long-running jobs as failed so the UI is not stuck forever."""
    from datetime import timedelta

    db = SessionLocal()
    try:
        cutoff = datetime.now(timezone.utc) - timedelta(minutes=older_than_minutes)
        stuck = db.query(CourseBuildJob).filter(CourseBuildJob.status == "RUNNING").all()
        count = 0
        for job in stuck:
            updated = job.updated_at
            if updated.tzinfo is None:
                updated = updated.replace(tzinfo=timezone.utc)
            if updated <= cutoff:
                job.status = "FAILED"
                job.error_message = (
                    "Generation timed out or was interrupted. "
                    "Please click Generate AI drafts again."
                )
                count += 1
        if count:
            db.commit()
        return count
    finally:
        db.close()


def _run_course_builder_job(db: Session, job_id: int) -> None:
    job = db.query(CourseBuildJob).filter(CourseBuildJob.id == job_id).first()
    if not job:
        return

    subject = db.query(Subject).filter(Subject.id == job.subject_id).first()
    if not subject:
        job.status = "FAILED"
        job.error_message = "Subject not found"
        db.commit()
        return

    job.status = "RUNNING"
    job.error_message = "Starting generation…"
    job.updated_at = datetime.now(timezone.utc)
    db.commit()

    def on_progress(message: str) -> None:
        set_job_progress(job_id, message)

    try:
        requested_raw = list(job.requested_artifacts or [])
        if any(
            item == ArtifactType.CHAPTER_NOTES.value or item.startswith(CHAPTER_NOTES_META_PREFIX)
            for item in requested_raw
        ):
            chapter_number = _chapter_number_from_requested(requested_raw)
            if chapter_number is None:
                raise ValueError("Chapter notes job is missing CHAPTER:{n} metadata")
            chapter = _get_chapter_from_learning_path(db, job.subject_id, chapter_number)
            if not chapter:
                raise ValueError(
                    f"Chapter {chapter_number} not found on the learning path. Generate the path first."
                )
            notes = get_course_builder_provider().generate_chapter_notes(
                subject_name=subject.name,
                chapter=chapter.chapter,
                chapter_title=chapter.title,
                topics=chapter.topics,
                objectives=chapter.objectives,
                summary=chapter.summary,
                syllabus_text=job.syllabus_text,
                syllabus_file_path=job.syllabus_file_url,
                on_progress=on_progress,
            )
            notes.chapter = chapter.chapter
            notes.chapter_title = chapter.title
            _save_chapter_notes(db, job, notes)
        else:
            requested = [
                ArtifactType(item)
                for item in requested_raw
                if item in {member.value for member in ArtifactType}
            ] or [ArtifactType.LEARNING_PATH]
            output = get_course_builder_provider().generate_course(
                subject_name=subject.name,
                syllabus_text=job.syllabus_text,
                syllabus_file_path=job.syllabus_file_url,
                requested_artifacts=requested,
                on_progress=on_progress,
            )
            _save_learning_path(db, job, output)
        job.status = "COMPLETED"
        job.error_message = None
        job.updated_at = datetime.now(timezone.utc)
        db.commit()
    except Exception as exc:  # noqa: BLE001 - surface AI/provider errors on the job row.
        job.status = "FAILED"
        job.error_message = str(exc)
        job.updated_at = datetime.now(timezone.utc)
        db.commit()


def _chapter_number_from_requested(requested: list[str]) -> int | None:
    for item in requested:
        if item.startswith(CHAPTER_NOTES_META_PREFIX):
            try:
                return int(item.split(":", 1)[1])
            except ValueError:
                return None
    return None


def _get_chapter_from_learning_path(db: Session, subject_id: int, chapter_number: int) -> ChapterContent | None:
    artifacts = (
        db.query(CourseArtifact)
        .filter(CourseArtifact.subject_id == subject_id, CourseArtifact.is_active.is_(True))
        .order_by(CourseArtifact.id.desc())
        .all()
    )
    chapters = assemble_chapters_from_artifacts(artifacts)
    return next((c for c in chapters if c.chapter == chapter_number), None)


def _learning_path_is_published(db: Session, subject_id: int) -> bool:
    artifact = (
        db.query(CourseArtifact)
        .filter(
            CourseArtifact.subject_id == subject_id,
            CourseArtifact.artifact_type == ArtifactType.LEARNING_PATH.value,
            CourseArtifact.is_active.is_(True),
        )
        .order_by(CourseArtifact.id.desc())
        .first()
    )
    return bool(artifact and artifact.is_published)


def _save_learning_path(db: Session, job: CourseBuildJob, output: CourseBuilderOutput) -> None:
    chapters = sorted(output.chapters, key=lambda item: item.chapter)
    if not chapters:
        raise ValueError("AI generation returned no chapters")

    (
        db.query(CourseArtifact)
        .filter(
            CourseArtifact.subject_id == job.subject_id,
            CourseArtifact.artifact_type.in_(
                [
                    ArtifactType.LEARNING_PATH.value,
                    ArtifactType.ROADMAP.value,
                    ArtifactType.FLASHCARDS.value,
                    ArtifactType.QUIZ.value,
                    ArtifactType.ASSESSMENT.value,
                ]
            ),
            CourseArtifact.is_published.is_(False),
            CourseArtifact.is_active.is_(True),
        )
        .update({"is_active": False}, synchronize_session=False)
    )

    db.add(
        CourseArtifact(
            subject_id=job.subject_id,
            job_id=job.id,
            created_by_id=job.created_by_id,
            artifact_type=ArtifactType.LEARNING_PATH.value,
            title="AI Learning Path",
            content=[
                {**chapter.model_dump(), "assessment": None, "flashcards": chapter.flashcards, "quiz": chapter.quiz}
                for chapter in chapters
            ],
            is_published=False,
        )
    )
    _ensure_chapter_locks(db, job.subject_id, [chapter.chapter for chapter in chapters], job.created_by_id)


def _save_chapter_notes(db: Session, job: CourseBuildJob, notes: ChapterNotesContent) -> None:
    if not notes.lessons:
        raise ValueError("AI generation returned no lesson notes")

    existing = (
        db.query(CourseArtifact)
        .filter(
            CourseArtifact.subject_id == job.subject_id,
            CourseArtifact.artifact_type == ArtifactType.CHAPTER_NOTES.value,
            CourseArtifact.is_active.is_(True),
        )
        .all()
    )
    for artifact in existing:
        content = artifact.content if isinstance(artifact.content, dict) else {}
        if int(content.get("chapter") or 0) == notes.chapter and not artifact.is_published:
            artifact.is_active = False

    published = _learning_path_is_published(db, job.subject_id)
    db.add(
        CourseArtifact(
            subject_id=job.subject_id,
            job_id=job.id,
            created_by_id=job.created_by_id,
            artifact_type=ArtifactType.CHAPTER_NOTES.value,
            title=f"Chapter {notes.chapter} Notes — {notes.chapter_title}",
            content=notes.model_dump(),
            is_published=published,
        )
    )


def sync_chapter_notes_publish_state(db: Session, subject_id: int, is_published: bool) -> None:
    artifacts = (
        db.query(CourseArtifact)
        .filter(
            CourseArtifact.subject_id == subject_id,
            CourseArtifact.artifact_type == ArtifactType.CHAPTER_NOTES.value,
            CourseArtifact.is_active.is_(True),
        )
        .all()
    )
    for artifact in artifacts:
        artifact.is_published = is_published


def find_chapter_notes_artifact(
    db: Session,
    subject_id: int,
    chapter_number: int,
    *,
    published_only: bool,
) -> CourseArtifact | None:
    query = (
        db.query(CourseArtifact)
        .filter(
            CourseArtifact.subject_id == subject_id,
            CourseArtifact.artifact_type == ArtifactType.CHAPTER_NOTES.value,
            CourseArtifact.is_active.is_(True),
        )
        .order_by(CourseArtifact.id.desc())
    )
    if published_only:
        query = query.filter(CourseArtifact.is_published.is_(True))
    for artifact in query.all():
        content = artifact.content if isinstance(artifact.content, dict) else {}
        if int(content.get("chapter") or 0) == chapter_number:
            return artifact
    return None


def find_active_notes_job(db: Session, subject_id: int, chapter_number: int) -> CourseBuildJob | None:
    marker = f"{CHAPTER_NOTES_META_PREFIX}{chapter_number}"
    jobs = (
        db.query(CourseBuildJob)
        .filter(
            CourseBuildJob.subject_id == subject_id,
            CourseBuildJob.status.in_(["PENDING", "RUNNING"]),
        )
        .order_by(CourseBuildJob.id.desc())
        .all()
    )
    for job in jobs:
        requested = job.requested_artifacts or []
        if ArtifactType.CHAPTER_NOTES.value in requested and marker in requested:
            return job
    return None


def find_latest_failed_notes_job(db: Session, subject_id: int, chapter_number: int) -> CourseBuildJob | None:
    marker = f"{CHAPTER_NOTES_META_PREFIX}{chapter_number}"
    jobs = (
        db.query(CourseBuildJob)
        .filter(
            CourseBuildJob.subject_id == subject_id,
            CourseBuildJob.status == "FAILED",
        )
        .order_by(CourseBuildJob.id.desc())
        .limit(20)
        .all()
    )
    for job in jobs:
        requested = job.requested_artifacts or []
        if ArtifactType.CHAPTER_NOTES.value in requested and marker in requested:
            return job
    return None


def _ensure_chapter_locks(
    db: Session,
    subject_id: int,
    chapter_numbers: list[int],
    updated_by_id: int | None,
) -> None:
    existing = {
        row.chapter_number: row
        for row in db.query(CourseChapterLock).filter(CourseChapterLock.subject_id == subject_id).all()
    }
    for number in chapter_numbers:
        if number in existing:
            continue
        db.add(
            CourseChapterLock(
                subject_id=subject_id,
                chapter_number=number,
                is_unlocked=(number == 1),
                updated_by_id=updated_by_id,
            )
        )


def assemble_chapters_from_artifacts(artifacts: list[CourseArtifact]) -> list[ChapterContent]:
    """Build chapter list from LEARNING_PATH or legacy flat artifacts."""
    latest: dict[str, CourseArtifact] = {}
    for artifact in sorted(artifacts, key=lambda item: item.id, reverse=True):
        if artifact.artifact_type not in latest:
            latest[artifact.artifact_type] = artifact

    learning = latest.get(ArtifactType.LEARNING_PATH.value)
    if learning and isinstance(learning.content, list) and learning.content:
        chapters: list[ChapterContent] = []
        for item in learning.content:
            if isinstance(item, dict) and "chapter" in item:
                chapters.append(ChapterContent.model_validate(item))
        if chapters:
            return sorted(chapters, key=lambda c: c.chapter)

    roadmap = latest.get(ArtifactType.ROADMAP.value)
    flashcards = latest.get(ArtifactType.FLASHCARDS.value)
    quiz = latest.get(ArtifactType.QUIZ.value)
    assessment = latest.get(ArtifactType.ASSESSMENT.value)

    weeks = roadmap.content if roadmap and isinstance(roadmap.content, list) else []
    cards = flashcards.content if flashcards and isinstance(flashcards.content, list) else []
    questions = quiz.content if quiz and isinstance(quiz.content, list) else []
    assessments = assessment.content if assessment and isinstance(assessment.content, list) else []

    if not weeks:
        return []

    chapters = []
    for index, week in enumerate(weeks):
        if not isinstance(week, dict):
            continue
        chapter_no = int(week.get("week") or week.get("chapter") or (index + 1))
        chapter_cards = [c for i, c in enumerate(cards) if isinstance(c, dict) and i % max(len(weeks), 1) == index]
        chapter_quiz = [q for i, q in enumerate(questions) if isinstance(q, dict) and i % max(len(weeks), 1) == index]
        chapter_assessment = None
        if assessments and isinstance(assessments[0], dict) and index == 0:
            chapter_assessment = assessments[0]
        elif assessments and index < len(assessments) and isinstance(assessments[index], dict):
            chapter_assessment = assessments[index]

        payload = {
            "chapter": chapter_no,
            "title": week.get("title") or f"Chapter {chapter_no}",
            "summary": week.get("student_outcome") or week.get("summary") or "",
            "timeline": week.get("timeline") or f"Week {chapter_no}",
            "objectives": week.get("objectives") or [],
            "topics": week.get("topics") or [],
            "activities": week.get("activities") or [],
            "flashcards": chapter_cards,
            "quiz": chapter_quiz,
            "assessment": chapter_assessment,
        }
        chapters.append(ChapterContent.model_validate(payload))
    return sorted(chapters, key=lambda c: c.chapter)
