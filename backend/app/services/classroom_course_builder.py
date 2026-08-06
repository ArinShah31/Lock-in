"""Classroom course builder job orchestration."""

from __future__ import annotations

import threading
import time
from datetime import datetime, timezone

from sqlalchemy.orm import Session

from app.core.database import SessionLocal
from app.models.classroom import Classroom
from app.models.classroom_course import ClassroomCourse, CourseBuildJob
from app.models.content import ClassroomContent
from app.services import groq_course
from app.services.source_text import build_source_text
from app.services.youtube import search_youtube_video


def _now() -> datetime:
    return datetime.now(timezone.utc)


def start_job(job_id: int) -> None:
    thread = threading.Thread(target=run_job, args=(job_id,), daemon=True)
    thread.start()


def run_job(job_id: int) -> None:
    db = SessionLocal()
    try:
        _execute_job(db, job_id)
    finally:
        db.close()


def fail_orphaned_jobs(
    *,
    reason: str = "Interrupted — server restarted. Click Generate all again.",
) -> int:
    """Mark PENDING/RUNNING jobs failed after process death (reload/crash).

    Generation runs in-process threads, so a uvicorn reload kills workers while
    DB rows can stay RUNNING forever without this recovery.
    """
    db = SessionLocal()
    try:
        rows = (
            db.query(CourseBuildJob)
            .filter(CourseBuildJob.status.in_(("PENDING", "RUNNING")))
            .all()
        )
        if not rows:
            return 0
        now = _now()
        for job in rows:
            job.status = "FAILED"
            job.error_message = reason[:2000]
            job.progress_message = "Interrupted"
            job.updated_at = now
        db.commit()
        return len(rows)
    finally:
        db.close()


def _set_progress(db: Session, job: CourseBuildJob, message: str) -> None:
    job.progress_message = message
    job.updated_at = _now()
    db.commit()


def _fail(db: Session, job: CourseBuildJob, message: str) -> None:
    job.status = "FAILED"
    job.error_message = message[:2000]
    job.updated_at = _now()
    db.commit()


def _complete(db: Session, job: CourseBuildJob, message: str | None = None) -> None:
    job.status = "COMPLETED"
    job.progress_message = message or "Done"
    job.error_message = None
    job.updated_at = _now()
    db.commit()


def _get_source_text(db: Session, course: ClassroomCourse, classroom: Classroom) -> str:
    docs: list[ClassroomContent] = []
    ids = list(course.source_content_ids or [])
    if ids:
        docs = (
            db.query(ClassroomContent)
            .filter(
                ClassroomContent.classroom_id == classroom.id,
                ClassroomContent.id.in_(ids),
                ClassroomContent.is_active.is_(True),
            )
            .all()
        )
    return build_source_text(
        syllabus_text=course.syllabus_text,
        syllabus_path=course.syllabus_file_path,
        syllabus_name=course.syllabus_file_name,
        documents=docs,
    )


def _chapters(course: ClassroomCourse) -> list[dict]:
    content = course.content or {}
    chapters = content.get("chapters") or []
    return list(chapters)


def _save_chapters(db: Session, course: ClassroomCourse, chapters: list[dict]) -> None:
    course.content = {"chapters": chapters}
    course.updated_at = _now()
    db.commit()
    db.refresh(course)


def _execute_job(db: Session, job_id: int) -> None:
    job = db.query(CourseBuildJob).filter(CourseBuildJob.id == job_id).first()
    if not job:
        return
    course = db.query(ClassroomCourse).filter(ClassroomCourse.id == job.course_id).first()
    classroom = db.query(Classroom).filter(Classroom.id == job.classroom_id).first()
    if not course or not classroom:
        _fail(db, job, "Course or classroom missing")
        return

    job.status = "RUNNING"
    job.progress_message = "Starting…"
    job.updated_at = _now()
    db.commit()

    try:
        if job.stage == "STRUCTURE":
            _run_structure(db, job, course, classroom)
        elif job.stage == "CHAPTER_CONTENT":
            _run_chapter_content(db, job, course, classroom)
        elif job.stage == "CHAPTER_QUIZ":
            _run_chapter_quiz(db, job, course, classroom)
        elif job.stage == "GENERATE_ASSESSMENTS":
            _run_generate_assessments(db, job, course, classroom)
        elif job.stage == "VIDEO":
            _run_video(db, job, course, classroom)
        elif job.stage == "GENERATE_ALL":
            _run_generate_all(db, job, course, classroom)
        else:
            _fail(db, job, f"Unknown stage: {job.stage}")
    except Exception as exc:  # noqa: BLE001
        _fail(db, job, str(exc))


def _run_structure(
    db: Session,
    job: CourseBuildJob,
    course: ClassroomCourse,
    classroom: Classroom,
) -> None:
    _set_progress(db, job, "Generating course structure…")
    source = _get_source_text(db, course, classroom)
    chapters = groq_course.generate_structure(classroom_name=classroom.name, source_text=source)
    _save_chapters(db, course, chapters)
    _complete(db, job, f"Created {len(chapters)} chapters")


def _run_chapter_content(
    db: Session,
    job: CourseBuildJob,
    course: ClassroomCourse,
    classroom: Classroom,
) -> None:
    if job.chapter_number is None:
        _fail(db, job, "chapter_number required")
        return
    chapters = _chapters(course)
    target = next((c for c in chapters if c.get("chapter") == job.chapter_number), None)
    if not target:
        _fail(db, job, "Chapter not found — generate structure first")
        return
    _set_progress(db, job, f"Building full lessons for chapter {job.chapter_number}…")
    source = _get_source_text(db, course, classroom)

    def on_progress(message: str) -> None:
        _set_progress(db, job, message)

    filled = groq_course.generate_chapter_content(
        classroom_name=classroom.name,
        chapter=target,
        source_text=source,
        on_progress=on_progress,
    )
    target["activities"] = filled["activities"]
    target["lessons"] = filled["lessons"]
    target["subtopics"] = filled["lessons"]
    # Preserve existing quiz/flashcards — assessments are a separate post-build step.
    _save_chapters(db, course, chapters)
    _complete(
        db,
        job,
        f"Chapter {job.chapter_number} ready ({len(filled['lessons'])} full lessons)",
    )


def _run_chapter_quiz(
    db: Session,
    job: CourseBuildJob,
    course: ClassroomCourse,
    classroom: Classroom,
) -> None:
    if job.chapter_number is None:
        _fail(db, job, "chapter_number required")
        return
    chapters = _chapters(course)
    target = next((c for c in chapters if c.get("chapter") == job.chapter_number), None)
    if not target:
        _fail(db, job, "Chapter not found")
        return
    _set_progress(db, job, f"Building assessments for chapter {job.chapter_number}…")
    assessments = groq_course.generate_chapter_assessments(
        classroom_name=classroom.name,
        chapter=target,
        include_flashcards=True,
    )
    target["quiz"] = assessments["quiz"]
    target["flashcards"] = assessments["flashcards"]
    _save_chapters(db, course, chapters)
    _complete(
        db,
        job,
        (
            f"Chapter {job.chapter_number} assessments ready "
            f"({len(assessments['quiz'])} quiz, {len(assessments['flashcards'])} flashcards)"
        ),
    )


def _run_generate_assessments(
    db: Session,
    job: CourseBuildJob,
    course: ClassroomCourse,
    classroom: Classroom,
) -> None:
    chapters = _chapters(course)
    if not chapters:
        _fail(db, job, "No chapters — generate the course first")
        return
    ready = [c for c in chapters if groq_course.chapter_lessons(c)]
    if not ready:
        _fail(db, job, "No lesson notes yet — run Generate all or regenerate content first")
        return
    total = len(ready)
    for i, ch in enumerate(ready, start=1):
        num = int(ch["chapter"])
        _set_progress(db, job, f"Assessments {i}/{total} (ch {num})…")
        _run_child_and_wait(db, job, stage="CHAPTER_QUIZ", chapter_number=num)
        db.refresh(course)
    _complete(db, job, f"Assessments finished ({total} chapters)")


def _run_video(
    db: Session,
    job: CourseBuildJob,
    course: ClassroomCourse,
    classroom: Classroom,
) -> None:
    if job.chapter_number is None or job.subtopic_index is None:
        _fail(db, job, "chapter_number and subtopic_index required")
        return
    chapters = _chapters(course)
    target = next((c for c in chapters if c.get("chapter") == job.chapter_number), None)
    if not target:
        _fail(db, job, "Chapter not found")
        return
    lessons = groq_course.chapter_lessons(target)
    if job.subtopic_index < 0 or job.subtopic_index >= len(lessons):
        _fail(db, job, "Lesson index out of range")
        return
    lesson = lessons[job.subtopic_index]
    needs_video = groq_course.infer_needs_video(
        str(lesson.get("title") or ""),
        lesson.get("needs_video") if isinstance(lesson.get("needs_video"), bool) else None,
    )
    if not needs_video:
        lesson["needs_video"] = False
        target["lessons"] = lessons
        target["subtopics"] = lessons
        _save_chapters(db, course, chapters)
        _complete(db, job, f"Skipped video for intro/overview: {lesson.get('title')}")
        return

    query = f"{classroom.name} {target.get('title')} {lesson.get('title')} tutorial"
    _set_progress(db, job, f"Finding YouTube video: {lesson.get('title')}…")
    video_id, title = search_youtube_video(query=query)
    lesson["youtube_video_id"] = video_id
    lesson["youtube_title"] = title
    lesson["youtube_url"] = f"https://www.youtube.com/watch?v={video_id}" if video_id else None
    lesson["needs_video"] = True
    target["lessons"] = lessons
    target["subtopics"] = lessons
    _save_chapters(db, course, chapters)
    if video_id:
        _complete(db, job, f"Video set: {title or video_id}")
    else:
        _complete(db, job, "No video found (add YouTube key or paste a URL)")


def _enqueue_child(
    db: Session,
    *,
    parent: CourseBuildJob,
    stage: str,
    chapter_number: int | None = None,
    subtopic_index: int | None = None,
) -> int:
    child = CourseBuildJob(
        classroom_id=parent.classroom_id,
        course_id=parent.course_id,
        created_by_id=parent.created_by_id,
        stage=stage,
        chapter_number=chapter_number,
        subtopic_index=subtopic_index,
        status="PENDING",
    )
    db.add(child)
    db.commit()
    db.refresh(child)
    return child.id


def _wait_job(db: Session, job_id: int, *, timeout_sec: int = 300) -> CourseBuildJob:
    started = time.time()
    while time.time() - started < timeout_sec:
        db.expire_all()
        job = db.query(CourseBuildJob).filter(CourseBuildJob.id == job_id).first()
        if not job:
            raise RuntimeError("Child job missing")
        if job.status in {"COMPLETED", "FAILED"}:
            return job
        time.sleep(1.0)
    raise TimeoutError(f"Job {job_id} timed out")


def _run_child_and_wait(
    db: Session,
    parent: CourseBuildJob,
    *,
    stage: str,
    chapter_number: int | None = None,
    subtopic_index: int | None = None,
) -> None:
    child_id = _enqueue_child(
        db,
        parent=parent,
        stage=stage,
        chapter_number=chapter_number,
        subtopic_index=subtopic_index,
    )
    # Run inline in this worker to keep ordering simple and avoid thread storms.
    _execute_job(db, child_id)
    child = db.query(CourseBuildJob).filter(CourseBuildJob.id == child_id).first()
    if child and child.status == "FAILED":
        raise RuntimeError(child.error_message or f"{stage} failed")
    time.sleep(0.4)  # gentle pacing between API calls


def _run_generate_all(
    db: Session,
    job: CourseBuildJob,
    course: ClassroomCourse,
    classroom: Classroom,
) -> None:
    _set_progress(db, job, "Generate all: structure…")
    _run_child_and_wait(db, job, stage="STRUCTURE")
    db.refresh(course)
    chapters = _chapters(course)
    total = len(chapters)
    for i, ch in enumerate(chapters, start=1):
        num = int(ch["chapter"])
        _set_progress(db, job, f"Generate all: content {i}/{total} (ch {num})…")
        _run_child_and_wait(db, job, stage="CHAPTER_CONTENT", chapter_number=num)
        db.refresh(course)
        chapters = _chapters(course)
        updated = next((c for c in chapters if c.get("chapter") == num), ch)
        lessons = groq_course.chapter_lessons(updated)
        for idx, lesson in enumerate(lessons):
            needs_video = groq_course.infer_needs_video(
                str(lesson.get("title") or ""),
                lesson.get("needs_video") if isinstance(lesson.get("needs_video"), bool) else None,
            )
            if not needs_video:
                continue
            _set_progress(db, job, f"Generate all: video ch {num} lesson {idx + 1}…")
            _run_child_and_wait(
                db,
                job,
                stage="VIDEO",
                chapter_number=num,
                subtopic_index=idx,
            )
    _complete(db, job, f"Generate all finished ({total} chapters). Run Generate assessments for quizzes.")
