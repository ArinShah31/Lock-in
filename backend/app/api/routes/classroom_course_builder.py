from pathlib import Path
import shutil
import uuid

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.api.routes.classrooms import (
    _ensure_view_access,
    _get_classroom_or_404,
)
from app.core.database import get_db
from app.models.classroom import Classroom, ClassroomStudent, MembershipStatus
from app.models.classroom_course import (
    ClassroomCourse,
    CourseBuildJob,
    CourseChapterAttempt,
    CourseChapterLock,
)
from app.models.content import ClassroomContent
from app.models.user import User, UserRole
from app.schemas.classroom_course import (
    AttemptOut,
    ChapterLockRequest,
    ChapterOut,
    ClassroomCourseOut,
    CourseBuildJobOut,
    LessonOut,
    PublishRequest,
    QuizAttemptRequest,
    SetSourcesRequest,
    SubtopicVideoUpdate,
)
from app.services.classroom_course_builder import start_job
from app.services import groq_course
from app.services.lesson_schema import lesson_has_content, normalize_lesson
from app.services.youtube import extract_youtube_id

router = APIRouter(tags=["course-builder"])

SYLLABUS_DIR = Path("uploads/course_syllabi")
SYLLABUS_DIR.mkdir(parents=True, exist_ok=True)


def _ensure_class_teacher(user: User, classroom: Classroom) -> None:
    if classroom.class_teacher_id != user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only the class teacher can manage the course builder",
        )


def _get_or_create_course(db: Session, classroom: Classroom, user: User) -> ClassroomCourse:
    course = (
        db.query(ClassroomCourse)
        .filter(ClassroomCourse.classroom_id == classroom.id, ClassroomCourse.is_active.is_(True))
        .first()
    )
    if course:
        return course
    course = ClassroomCourse(
        classroom_id=classroom.id,
        created_by_id=user.id,
        title=f"{classroom.name} Course",
        source_content_ids=[],
        content={"chapters": []},
    )
    db.add(course)
    db.commit()
    db.refresh(course)
    return course


def _locks_map(db: Session, classroom_id: int) -> dict[int, bool]:
    locks = db.query(CourseChapterLock).filter(CourseChapterLock.classroom_id == classroom_id).all()
    return {lock.chapter_number: lock.is_unlocked for lock in locks}


def _as_str_list(values: list | None) -> list[str]:
    result: list[str] = []
    for item in values or []:
        if isinstance(item, str):
            text = item.strip()
            if text:
                result.append(text)
        elif isinstance(item, dict):
            text = str(
                item.get("title")
                or item.get("name")
                or item.get("text")
                or item.get("description")
                or ""
            ).strip()
            if text:
                result.append(text)
        elif item is not None:
            text = str(item).strip()
            if text:
                result.append(text)
    return result


def _course_out(
    course: ClassroomCourse,
    *,
    is_teacher: bool,
    locks: dict[int, bool],
) -> ClassroomCourseOut:
    raw_chapters = (course.content or {}).get("chapters") or []
    chapters: list[ChapterOut] = []
    for ch in raw_chapters:
        num = int(ch.get("chapter") or 0)
        unlocked = bool(locks.get(num, False))
        locked_for_viewer = (not is_teacher) and (not course.is_published or not unlocked)
        lessons_raw = groq_course.chapter_lessons(ch)
        lessons: list[LessonOut] = []
        for idx, st in enumerate(lessons_raw, start=1):
            if not isinstance(st, dict):
                continue
            normalized = normalize_lesson(st, index=idx)
            title = str(normalized.get("title") or f"Lesson {idx}")
            needs = normalized.get("needs_video")
            needs_video = groq_course.infer_needs_video(
                title,
                needs if isinstance(needs, bool) else None,
            )
            lessons.append(
                LessonOut(
                    lesson=int(normalized.get("lesson") or idx),
                    title=title,
                    overview=str(normalized.get("overview") or ""),
                    learning_objectives=list(normalized.get("learning_objectives") or []),
                    prerequisites=list(normalized.get("prerequisites") or []),
                    sections=list(normalized.get("sections") or []),
                    examples=list(normalized.get("examples") or []),
                    real_world_applications=list(normalized.get("real_world_applications") or []),
                    common_misconceptions=list(normalized.get("common_misconceptions") or []),
                    key_terms=list(normalized.get("key_terms") or []),
                    summary=str(normalized.get("summary") or ""),
                    references=list(normalized.get("references") or []),
                    learning_outcomes=list(normalized.get("learning_objectives") or []),
                    notes_markdown="",
                    practice_prompts=[],
                    needs_video=needs_video,
                    youtube_video_id=normalized.get("youtube_video_id"),
                    youtube_title=normalized.get("youtube_title"),
                    youtube_url=normalized.get("youtube_url"),
                )
            )
        flashcards = []
        for fc in ch.get("flashcards") or []:
            if not isinstance(fc, dict):
                continue
            flashcards.append(
                {
                    "question": str(fc.get("question") or ""),
                    "answer": str(fc.get("answer") or ""),
                    "topic": str(fc.get("topic") or "General"),
                }
            )
        quiz = []
        for q in ch.get("quiz") or []:
            if not isinstance(q, dict):
                continue
            options = [str(o) for o in (q.get("options") or [])]
            quiz.append(
                {
                    "question": str(q.get("question") or ""),
                    "options": options,
                    "correct_answer": str(q.get("correct_answer") or (options[0] if options else "")),
                    "explanation": str(q.get("explanation") or ""),
                }
            )
        chapters.append(
            ChapterOut(
                chapter=num,
                title=str(ch.get("title") or f"Chapter {num}"),
                summary=str(ch.get("summary") or ""),
                timeline=str(ch.get("timeline") or ""),
                objectives=_as_str_list(ch.get("objectives")),
                topics=_as_str_list(ch.get("topics")),
                activities=_as_str_list(ch.get("activities")),
                lessons=[] if locked_for_viewer else lessons,
                subtopics=[] if locked_for_viewer else lessons,
                flashcards=[] if locked_for_viewer else flashcards,
                quiz=[] if locked_for_viewer else quiz,
                is_unlocked=unlocked,
                is_locked_for_viewer=locked_for_viewer,
                content_ready=any(
                    lesson_has_content(st) for st in lessons_raw if isinstance(st, dict)
                ),
                quiz_ready=bool(ch.get("quiz")),
            )
        )
    return ClassroomCourseOut(
        id=course.id,
        classroom_id=course.classroom_id,
        title=course.title,
        syllabus_file_name=course.syllabus_file_name,
        source_content_ids=list(course.source_content_ids or []),
        is_published=course.is_published,
        chapters=chapters,
        created_at=course.created_at,
        updated_at=course.updated_at,
    )


def _create_job(
    db: Session,
    *,
    classroom: Classroom,
    course: ClassroomCourse,
    user: User,
    stage: str,
    chapter_number: int | None = None,
    subtopic_index: int | None = None,
) -> CourseBuildJob:
    active = (
        db.query(CourseBuildJob)
        .filter(
            CourseBuildJob.classroom_id == classroom.id,
            CourseBuildJob.status.in_(("PENDING", "RUNNING")),
        )
        .first()
    )
    if active:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=(
                "A generation job is already running for this classroom. "
                "Wait for it to finish before starting another."
            ),
        )
    job = CourseBuildJob(
        classroom_id=classroom.id,
        course_id=course.id,
        created_by_id=user.id,
        stage=stage,
        chapter_number=chapter_number,
        subtopic_index=subtopic_index,
        status="PENDING",
    )
    db.add(job)
    db.commit()
    db.refresh(job)
    start_job(job.id)
    return job


@router.get("/classrooms/{classroom_id}/course-builder", response_model=ClassroomCourseOut)
def get_course(
    classroom_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    classroom = _get_classroom_or_404(db, classroom_id)
    _ensure_view_access(db, current_user, classroom)
    is_teacher = classroom.class_teacher_id == current_user.id
    course = _get_or_create_course(db, classroom, current_user)
    if not is_teacher and not course.is_published:
        return ClassroomCourseOut(
            id=course.id,
            classroom_id=course.classroom_id,
            title=course.title,
            syllabus_file_name=None,
            source_content_ids=[],
            is_published=False,
            chapters=[],
            created_at=course.created_at,
            updated_at=course.updated_at,
        )
    return _course_out(course, is_teacher=is_teacher, locks=_locks_map(db, classroom_id))


@router.post("/classrooms/{classroom_id}/course-builder/syllabus", response_model=ClassroomCourseOut)
async def upload_syllabus(
    classroom_id: int,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    classroom = _get_classroom_or_404(db, classroom_id)
    _ensure_view_access(db, current_user, classroom)
    _ensure_class_teacher(current_user, classroom)
    course = _get_or_create_course(db, classroom, current_user)

    if not file.filename:
        raise HTTPException(status_code=400, detail="File required")
    stored = f"{uuid.uuid4()}{Path(file.filename).suffix}"
    dest = SYLLABUS_DIR / stored
    with dest.open("wb") as buffer:
        shutil.copyfileobj(file.file, buffer)

    course.syllabus_file_name = file.filename
    course.syllabus_stored_name = stored
    course.syllabus_file_path = str(dest).replace("\\", "/")
    db.commit()
    db.refresh(course)
    return _course_out(course, is_teacher=True, locks=_locks_map(db, classroom_id))


@router.put("/classrooms/{classroom_id}/course-builder/sources", response_model=ClassroomCourseOut)
def set_sources(
    classroom_id: int,
    payload: SetSourcesRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    classroom = _get_classroom_or_404(db, classroom_id)
    _ensure_view_access(db, current_user, classroom)
    _ensure_class_teacher(current_user, classroom)
    course = _get_or_create_course(db, classroom, current_user)

    if payload.use_all_documents:
        ids = [
            c.id
            for c in db.query(ClassroomContent)
            .filter(
                ClassroomContent.classroom_id == classroom_id,
                ClassroomContent.is_active.is_(True),
            )
            .all()
        ]
    else:
        ids = list(dict.fromkeys(payload.source_content_ids))
        if ids:
            found = (
                db.query(ClassroomContent)
                .filter(
                    ClassroomContent.classroom_id == classroom_id,
                    ClassroomContent.id.in_(ids),
                    ClassroomContent.is_active.is_(True),
                )
                .count()
            )
            if found != len(ids):
                raise HTTPException(status_code=400, detail="Invalid document selection")

    course.source_content_ids = ids
    db.commit()
    db.refresh(course)
    return _course_out(course, is_teacher=True, locks=_locks_map(db, classroom_id))


@router.post(
    "/classrooms/{classroom_id}/course-builder/generate-all",
    response_model=CourseBuildJobOut,
    status_code=status.HTTP_201_CREATED,
)
def generate_all(
    classroom_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    classroom = _get_classroom_or_404(db, classroom_id)
    _ensure_view_access(db, current_user, classroom)
    _ensure_class_teacher(current_user, classroom)
    course = _get_or_create_course(db, classroom, current_user)
    if not course.syllabus_file_path and not (course.source_content_ids or []):
        raise HTTPException(
            status_code=400,
            detail="Upload a syllabus and/or select classroom documents first",
        )
    return _create_job(db, classroom=classroom, course=course, user=current_user, stage="GENERATE_ALL")


@router.post(
    "/classrooms/{classroom_id}/course-builder/generate/assessments",
    response_model=CourseBuildJobOut,
    status_code=status.HTTP_201_CREATED,
)
def generate_assessments(
    classroom_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    classroom = _get_classroom_or_404(db, classroom_id)
    _ensure_view_access(db, current_user, classroom)
    _ensure_class_teacher(current_user, classroom)
    course = _get_or_create_course(db, classroom, current_user)
    chapters = (course.content or {}).get("chapters") or []
    if not chapters:
        raise HTTPException(
            status_code=400,
            detail="Generate course structure first",
        )
    return _create_job(
        db,
        classroom=classroom,
        course=course,
        user=current_user,
        stage="GENERATE_ASSESSMENTS",
    )


@router.post(
    "/classrooms/{classroom_id}/course-builder/generate/structure",
    response_model=CourseBuildJobOut,
    status_code=status.HTTP_201_CREATED,
)
def generate_structure(
    classroom_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    classroom = _get_classroom_or_404(db, classroom_id)
    _ensure_view_access(db, current_user, classroom)
    _ensure_class_teacher(current_user, classroom)
    course = _get_or_create_course(db, classroom, current_user)
    return _create_job(db, classroom=classroom, course=course, user=current_user, stage="STRUCTURE")


@router.post(
    "/classrooms/{classroom_id}/course-builder/chapters/{chapter_number}/generate-content",
    response_model=CourseBuildJobOut,
    status_code=status.HTTP_201_CREATED,
)
def generate_chapter_content(
    classroom_id: int,
    chapter_number: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    classroom = _get_classroom_or_404(db, classroom_id)
    _ensure_view_access(db, current_user, classroom)
    _ensure_class_teacher(current_user, classroom)
    course = _get_or_create_course(db, classroom, current_user)
    return _create_job(
        db,
        classroom=classroom,
        course=course,
        user=current_user,
        stage="CHAPTER_CONTENT",
        chapter_number=chapter_number,
    )


@router.post(
    "/classrooms/{classroom_id}/course-builder/chapters/{chapter_number}/generate-quiz",
    response_model=CourseBuildJobOut,
    status_code=status.HTTP_201_CREATED,
)
def generate_chapter_quiz(
    classroom_id: int,
    chapter_number: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    classroom = _get_classroom_or_404(db, classroom_id)
    _ensure_view_access(db, current_user, classroom)
    _ensure_class_teacher(current_user, classroom)
    course = _get_or_create_course(db, classroom, current_user)
    return _create_job(
        db,
        classroom=classroom,
        course=course,
        user=current_user,
        stage="CHAPTER_QUIZ",
        chapter_number=chapter_number,
    )


@router.post(
    "/classrooms/{classroom_id}/course-builder/chapters/{chapter_number}/subtopics/{subtopic_index}/generate-video",
    response_model=CourseBuildJobOut,
    status_code=status.HTTP_201_CREATED,
)
def generate_subtopic_video(
    classroom_id: int,
    chapter_number: int,
    subtopic_index: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    classroom = _get_classroom_or_404(db, classroom_id)
    _ensure_view_access(db, current_user, classroom)
    _ensure_class_teacher(current_user, classroom)
    course = _get_or_create_course(db, classroom, current_user)
    return _create_job(
        db,
        classroom=classroom,
        course=course,
        user=current_user,
        stage="VIDEO",
        chapter_number=chapter_number,
        subtopic_index=subtopic_index,
    )


@router.patch(
    "/classrooms/{classroom_id}/course-builder/chapters/{chapter_number}/subtopics/{subtopic_index}/video",
    response_model=ClassroomCourseOut,
)
def set_subtopic_video(
    classroom_id: int,
    chapter_number: int,
    subtopic_index: int,
    payload: SubtopicVideoUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    classroom = _get_classroom_or_404(db, classroom_id)
    _ensure_view_access(db, current_user, classroom)
    _ensure_class_teacher(current_user, classroom)
    course = _get_or_create_course(db, classroom, current_user)
    chapters = list((course.content or {}).get("chapters") or [])
    target = next((c for c in chapters if int(c.get("chapter") or 0) == chapter_number), None)
    if not target:
        raise HTTPException(status_code=404, detail="Chapter not found")
    lessons = groq_course.chapter_lessons(target)
    if subtopic_index < 0 or subtopic_index >= len(lessons):
        raise HTTPException(status_code=404, detail="Lesson not found")
    st = lessons[subtopic_index]
    if not payload.youtube_url:
        st["youtube_video_id"] = None
        st["youtube_title"] = None
        st["youtube_url"] = None
    else:
        vid = extract_youtube_id(payload.youtube_url)
        if not vid:
            raise HTTPException(status_code=400, detail="Invalid YouTube URL")
        st["youtube_video_id"] = vid
        st["youtube_url"] = f"https://www.youtube.com/watch?v={vid}"
        st["youtube_title"] = st.get("youtube_title") or "Teacher selected video"
        st["needs_video"] = True
    target["lessons"] = lessons
    target["subtopics"] = lessons
    course.content = {"chapters": chapters}
    db.commit()
    db.refresh(course)
    return _course_out(course, is_teacher=True, locks=_locks_map(db, classroom_id))


@router.get("/classrooms/{classroom_id}/course-builder/jobs/{job_id}", response_model=CourseBuildJobOut)
def get_job(
    classroom_id: int,
    job_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    classroom = _get_classroom_or_404(db, classroom_id)
    _ensure_view_access(db, current_user, classroom)
    _ensure_class_teacher(current_user, classroom)
    job = (
        db.query(CourseBuildJob)
        .filter(CourseBuildJob.id == job_id, CourseBuildJob.classroom_id == classroom_id)
        .first()
    )
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    return job


@router.get("/classrooms/{classroom_id}/course-builder/jobs", response_model=list[CourseBuildJobOut])
def list_jobs(
    classroom_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    classroom = _get_classroom_or_404(db, classroom_id)
    _ensure_view_access(db, current_user, classroom)
    _ensure_class_teacher(current_user, classroom)
    return (
        db.query(CourseBuildJob)
        .filter(CourseBuildJob.classroom_id == classroom_id)
        .order_by(CourseBuildJob.id.desc())
        .limit(30)
        .all()
    )


@router.patch("/classrooms/{classroom_id}/course-builder/publish", response_model=ClassroomCourseOut)
def publish_course(
    classroom_id: int,
    payload: PublishRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    classroom = _get_classroom_or_404(db, classroom_id)
    _ensure_view_access(db, current_user, classroom)
    _ensure_class_teacher(current_user, classroom)
    course = _get_or_create_course(db, classroom, current_user)
    course.is_published = payload.is_published
    db.commit()
    db.refresh(course)
    return _course_out(course, is_teacher=True, locks=_locks_map(db, classroom_id))


@router.patch(
    "/classrooms/{classroom_id}/course-builder/chapters/{chapter_number}/lock",
    response_model=ClassroomCourseOut,
)
def set_chapter_lock(
    classroom_id: int,
    chapter_number: int,
    payload: ChapterLockRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    classroom = _get_classroom_or_404(db, classroom_id)
    _ensure_view_access(db, current_user, classroom)
    _ensure_class_teacher(current_user, classroom)
    course = _get_or_create_course(db, classroom, current_user)
    lock = (
        db.query(CourseChapterLock)
        .filter(
            CourseChapterLock.classroom_id == classroom_id,
            CourseChapterLock.chapter_number == chapter_number,
        )
        .first()
    )
    if not lock:
        lock = CourseChapterLock(
            classroom_id=classroom_id,
            chapter_number=chapter_number,
            is_unlocked=payload.is_unlocked,
            updated_by_id=current_user.id,
        )
        db.add(lock)
    else:
        lock.is_unlocked = payload.is_unlocked
        lock.updated_by_id = current_user.id
    db.commit()
    return _course_out(course, is_teacher=True, locks=_locks_map(db, classroom_id))


@router.post(
    "/classrooms/{classroom_id}/course-builder/chapters/{chapter_number}/quiz-attempt",
    response_model=AttemptOut,
    status_code=status.HTTP_201_CREATED,
)
def submit_quiz_attempt(
    classroom_id: int,
    chapter_number: int,
    payload: QuizAttemptRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if current_user.role != UserRole.STUDENT:
        raise HTTPException(status_code=403, detail="Only students can submit quiz attempts")
    classroom = _get_classroom_or_404(db, classroom_id)
    _ensure_view_access(db, current_user, classroom)
    membership = (
        db.query(ClassroomStudent)
        .filter(
            ClassroomStudent.classroom_id == classroom_id,
            ClassroomStudent.student_id == current_user.id,
            ClassroomStudent.status == MembershipStatus.APPROVED,
            ClassroomStudent.is_active.is_(True),
        )
        .first()
    )
    if not membership:
        raise HTTPException(status_code=403, detail="Not an approved student in this classroom")

    course = (
        db.query(ClassroomCourse)
        .filter(ClassroomCourse.classroom_id == classroom_id, ClassroomCourse.is_active.is_(True))
        .first()
    )
    if not course or not course.is_published:
        raise HTTPException(status_code=404, detail="Course not published")
    locks = _locks_map(db, classroom_id)
    if not locks.get(chapter_number, False):
        raise HTTPException(status_code=403, detail="Chapter is locked")

    chapters = (course.content or {}).get("chapters") or []
    target = next((c for c in chapters if int(c.get("chapter") or 0) == chapter_number), None)
    if not target:
        raise HTTPException(status_code=404, detail="Chapter not found")
    quiz = target.get("quiz") or []
    correct = 0
    for i, q in enumerate(quiz):
        selected = payload.selected_answers[i] if i < len(payload.selected_answers) else None
        if selected and selected == q.get("correct_answer"):
            correct += 1
    score = (correct / len(quiz) * 100.0) if quiz else 0.0
    attempt = CourseChapterAttempt(
        classroom_id=classroom_id,
        chapter_number=chapter_number,
        user_id=current_user.id,
        attempt_type="QUIZ",
        score=score,
        payload={"selected_answers": payload.selected_answers, "correct": correct, "total": len(quiz)},
    )
    db.add(attempt)
    db.commit()
    db.refresh(attempt)
    return attempt
