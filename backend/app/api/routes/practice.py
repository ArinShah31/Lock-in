from math import ceil
import logging

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.api.routes.classrooms import _ensure_view_access, _get_classroom_or_404
from app.core.database import get_db
from app.models.classroom import Classroom, ClassroomStudent, MembershipStatus
from app.models.classroom_course import (
    ClassroomCourse,
    CourseChapterAttempt,
    PracticeAssessmentLock,
)
from app.models.content import ClassroomContent
from app.models.user import User, UserRole
from app.services.practice_gemini import generate_practice_chapters
from app.schemas.practice import (
    PracticeAssessmentLockRequest,
    PracticeAssessmentOut,
    PracticeAttemptOut,
    PracticeAttemptRequest,
    PracticeFlashcardDeckOut,
    PracticeFlashcardOut,
    PracticeOverviewOut,
    PracticeQuestionOut,
    PracticeQuizOut,
    PracticeSummaryOut,
)

router = APIRouter(tags=["practice"])
logger = logging.getLogger(__name__)

ASSESSMENT_TOPIC = "ASSESSMENT_TOPIC"
ASSESSMENT_SUBJECT = "ASSESSMENT_SUBJECT"
ASSESSMENT_KIND_TOPIC = "TOPIC"
ASSESSMENT_KIND_SUBJECT = "SUBJECT"
SUBJECT_TARGET_KEY = "overall"


def _ensure_class_teacher(user: User, classroom: Classroom) -> None:
    if user.role == UserRole.SUPER_ADMIN:
        return
    if classroom.class_teacher_id != user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only the class teacher can manage assessment access",
        )


def _require_student_membership(db: Session, classroom_id: int, user: User) -> None:
    membership = (
        db.query(ClassroomStudent)
        .filter(
            ClassroomStudent.classroom_id == classroom_id,
            ClassroomStudent.student_id == user.id,
            ClassroomStudent.status == MembershipStatus.APPROVED,
            ClassroomStudent.is_active.is_(True),
        )
        .first()
    )
    if not membership:
        raise HTTPException(status_code=403, detail="Not an approved student in this classroom")


def _get_course(db: Session, classroom_id: int) -> ClassroomCourse | None:
    return (
        db.query(ClassroomCourse)
        .filter(
            ClassroomCourse.classroom_id == classroom_id,
            ClassroomCourse.is_active.is_(True),
        )
        .first()
    )


def _get_or_create_course(db: Session, classroom: Classroom, user: User) -> ClassroomCourse:
    course = _get_course(db, classroom.id)
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


def _active_documents(db: Session, classroom_id: int) -> list[ClassroomContent]:
    return (
        db.query(ClassroomContent)
        .filter(
            ClassroomContent.classroom_id == classroom_id,
            ClassroomContent.is_active.is_(True),
        )
        .order_by(ClassroomContent.created_at.asc())
        .all()
    )


def _save_chapters(db: Session, course: ClassroomCourse, chapters: list[dict]) -> None:
    course.content = {"chapters": chapters}
    db.commit()
    db.refresh(course)


def _needs_practice_regeneration(chapters: list[dict], *, source_changed: bool) -> bool:
    if source_changed or not chapters:
        return True
    for chapter in chapters:
        if not isinstance(chapter, dict):
            continue
        if str(chapter.get("timeline") or "").strip() == "Local practice generation":
            return True
        if not chapter.get("quiz") or not chapter.get("flashcards"):
            return True
    return False


def _bootstrap_practice_content(
    db: Session,
    *,
    classroom: Classroom,
    course: ClassroomCourse,
) -> ClassroomCourse:
    documents = _active_documents(db, classroom.id)
    if not documents and not course.syllabus_text and not course.syllabus_file_path:
        return course

    document_ids = [document.id for document in documents]
    source_changed = document_ids != list(course.source_content_ids or [])
    if source_changed:
        course.source_content_ids = document_ids
        db.commit()
        db.refresh(course)

    chapters = list((course.content or {}).get("chapters") or [])
    if _needs_practice_regeneration(chapters, source_changed=source_changed):
        try:
            chapters = generate_practice_chapters(
                classroom_name=classroom.name,
                syllabus_text=course.syllabus_text,
                syllabus_path=course.syllabus_file_path,
                syllabus_name=course.syllabus_file_name,
                documents=documents,
            )
            _save_chapters(db, course, chapters)
        except Exception as exc:
            logger.warning("Practice generation skipped for classroom %s: %s", classroom.id, exc)
    return course


def _estimate_minutes(question_count: int, *, seconds_per_question: int) -> int:
    if question_count <= 0:
        return 0
    return max(5, ceil((question_count * seconds_per_question) / 60))


def _topic_label(chapter: dict) -> str:
    topics = [str(item).strip() for item in (chapter.get("topics") or []) if str(item).strip()]
    return topics[0] if topics else f"Chapter {int(chapter.get('chapter') or 0)}"


def _question_out_list(items: list[dict]) -> list[PracticeQuestionOut]:
    result: list[PracticeQuestionOut] = []
    for item in items:
        if not isinstance(item, dict):
            continue
        question = str(item.get("question") or "").strip()
        options = [str(option).strip() for option in (item.get("options") or []) if str(option).strip()]
        if question and options:
            result.append(PracticeQuestionOut(question=question, options=options))
    return result


def _latest_attempt_map(
    db: Session,
    *,
    classroom_id: int,
    user_id: int,
    attempt_type: str,
) -> dict[str, CourseChapterAttempt]:
    rows = (
        db.query(CourseChapterAttempt)
        .filter(
            CourseChapterAttempt.classroom_id == classroom_id,
            CourseChapterAttempt.user_id == user_id,
            CourseChapterAttempt.attempt_type == attempt_type,
        )
        .order_by(CourseChapterAttempt.created_at.desc(), CourseChapterAttempt.id.desc())
        .all()
    )
    latest: dict[str, CourseChapterAttempt] = {}
    for row in rows:
        if attempt_type == "QUIZ":
            key = str(row.chapter_number)
        else:
            key = str(row.payload.get("target_key") or row.chapter_number)
        latest.setdefault(key, row)
    return latest


def _assessment_lock_map(db: Session, classroom_id: int) -> dict[tuple[str, str], bool]:
    rows = (
        db.query(PracticeAssessmentLock)
        .filter(PracticeAssessmentLock.classroom_id == classroom_id)
        .all()
    )
    return {(row.assessment_kind.upper(), row.target_key): row.is_unlocked for row in rows}


def _overview_payload(
    db: Session,
    *,
    classroom: Classroom,
    course: ClassroomCourse | None,
    viewer: User,
) -> PracticeOverviewOut:
    source_document_count = (
        db.query(ClassroomContent)
        .filter(
            ClassroomContent.classroom_id == classroom.id,
            ClassroomContent.is_active.is_(True),
        )
        .count()
    )
    if not course:
        return PracticeOverviewOut(
            classroom_id=classroom.id,
            classroom_name=classroom.name,
            course_title=None,
            source_document_count=source_document_count,
            summary=PracticeSummaryOut(source_document_count=source_document_count),
            quizzes=[],
            flashcard_decks=[],
            topic_assessments=[],
            subject_assessments=[],
        )

    quiz_attempts = _latest_attempt_map(
        db,
        classroom_id=classroom.id,
        user_id=viewer.id,
        attempt_type="QUIZ",
    )
    topic_assessment_attempts = _latest_attempt_map(
        db,
        classroom_id=classroom.id,
        user_id=viewer.id,
        attempt_type=ASSESSMENT_TOPIC,
    )
    subject_assessment_attempts = _latest_attempt_map(
        db,
        classroom_id=classroom.id,
        user_id=viewer.id,
        attempt_type=ASSESSMENT_SUBJECT,
    )
    lock_map = _assessment_lock_map(db, classroom.id)

    quizzes: list[PracticeQuizOut] = []
    flashcard_decks: list[PracticeFlashcardDeckOut] = []
    topic_assessments: list[PracticeAssessmentOut] = []
    all_subject_questions: list[PracticeQuestionOut] = []
    total_subject_question_count = 0

    chapters = list((course.content or {}).get("chapters") or [])
    for chapter in chapters:
        if not isinstance(chapter, dict):
            continue
        chapter_number = int(chapter.get("chapter") or 0)
        chapter_title = str(chapter.get("title") or f"Chapter {chapter_number}").strip()
        chapter_summary = str(chapter.get("summary") or "").strip()
        chapter_quiz_raw = [item for item in (chapter.get("quiz") or []) if isinstance(item, dict)]
        chapter_quiz = _question_out_list(chapter_quiz_raw)
        latest_quiz_attempt = quiz_attempts.get(str(chapter_number))

        if chapter_quiz:
            quizzes.append(
                PracticeQuizOut(
                    chapter_number=chapter_number,
                    title=chapter_title,
                    summary=chapter_summary,
                    topic_label=_topic_label(chapter),
                    question_count=len(chapter_quiz),
                    latest_score=latest_quiz_attempt.score if latest_quiz_attempt else None,
                    latest_attempted_at=latest_quiz_attempt.created_at if latest_quiz_attempt else None,
                    questions=chapter_quiz,
                )
            )
            all_subject_questions.extend(chapter_quiz)
            total_subject_question_count += len(chapter_quiz)

        flashcards_raw = [item for item in (chapter.get("flashcards") or []) if isinstance(item, dict)]
        cards: list[PracticeFlashcardOut] = []
        for index, card in enumerate(flashcards_raw, start=1):
            question = str(card.get("question") or "").strip()
            answer = str(card.get("answer") or "").strip()
            topic = str(card.get("topic") or _topic_label(chapter)).strip()
            if not question or not answer:
                continue
            cards.append(
                PracticeFlashcardOut(
                    id=f"chapter-{chapter_number}-card-{index}",
                    question=question,
                    answer=answer,
                    cue=f"Focus on {topic}. Recall the answer before flipping.",
                )
            )
        if cards:
            flashcard_decks.append(
                PracticeFlashcardDeckOut(
                    id=f"chapter-{chapter_number}",
                    title=chapter_title,
                    subject=classroom.name,
                    summary=chapter_summary or f"Revision deck generated from {chapter_title}.",
                    focus=f"Generated from classroom documents and syllabus for {chapter_title}.",
                    estimated_time=f"{max(4, ceil(len(cards) * 0.75))} min",
                    mastery_hint="Pause before revealing the back. Strong recall comes from retrieval first.",
                    cards=cards,
                )
            )

        topic_attempt = topic_assessment_attempts.get(str(chapter_number))
        is_topic_locked = not lock_map.get((ASSESSMENT_KIND_TOPIC, str(chapter_number)), False)
        if chapter_quiz:
            topic_assessments.append(
                PracticeAssessmentOut(
                    assessment_kind=ASSESSMENT_KIND_TOPIC,
                    target_key=str(chapter_number),
                    title=chapter_title,
                    meta=f"Topic wise · {classroom.name}",
                    detail=chapter_summary or f"Timed assessment generated around the concepts in {chapter_title}.",
                    question_count=len(chapter_quiz),
                    duration_minutes=_estimate_minutes(len(chapter_quiz), seconds_per_question=90),
                    is_locked=is_topic_locked,
                    latest_score=topic_attempt.score if topic_attempt else None,
                    latest_attempted_at=topic_attempt.created_at if topic_attempt else None,
                    questions=chapter_quiz,
                )
            )

    subject_assessments: list[PracticeAssessmentOut] = []
    if all_subject_questions:
        subject_attempt = subject_assessment_attempts.get(SUBJECT_TARGET_KEY)
        is_subject_locked = not lock_map.get((ASSESSMENT_KIND_SUBJECT, SUBJECT_TARGET_KEY), False)
        subject_assessments.append(
            PracticeAssessmentOut(
                assessment_kind=ASSESSMENT_KIND_SUBJECT,
                target_key=SUBJECT_TARGET_KEY,
                title=f"{classroom.name} Full Revision Assessment",
                meta="Subject wise · Full classroom scope",
                detail="A broader mixed assessment generated from the classroom syllabus and uploaded documents.",
                question_count=total_subject_question_count,
                duration_minutes=_estimate_minutes(total_subject_question_count, seconds_per_question=105),
                is_locked=is_subject_locked,
                latest_score=subject_attempt.score if subject_attempt else None,
                latest_attempted_at=subject_attempt.created_at if subject_attempt else None,
                questions=all_subject_questions,
            )
        )

    summary = PracticeSummaryOut(
        source_document_count=source_document_count,
        ready_quizzes=len(quizzes),
        flashcard_decks=len(flashcard_decks),
        locked_assessments=sum(1 for item in [*topic_assessments, *subject_assessments] if item.is_locked),
        completed_quizzes=sum(1 for item in quizzes if item.latest_score is not None),
        completed_assessments=sum(
            1 for item in [*topic_assessments, *subject_assessments] if item.latest_score is not None
        ),
    )
    return PracticeOverviewOut(
        classroom_id=classroom.id,
        classroom_name=classroom.name,
        course_title=course.title,
        source_document_count=source_document_count,
        summary=summary,
        quizzes=quizzes,
        flashcard_decks=flashcard_decks,
        topic_assessments=topic_assessments,
        subject_assessments=subject_assessments,
    )


def _find_chapter_quiz(course: ClassroomCourse, chapter_number: int) -> list[dict]:
    chapters = list((course.content or {}).get("chapters") or [])
    target = next((chapter for chapter in chapters if int(chapter.get("chapter") or 0) == chapter_number), None)
    if not target:
        raise HTTPException(status_code=404, detail="Chapter not found")
    quiz = [item for item in (target.get("quiz") or []) if isinstance(item, dict)]
    if not quiz:
        raise HTTPException(status_code=400, detail="Quiz is not ready for this chapter yet")
    return quiz


def _find_assessment_questions(
    *,
    course: ClassroomCourse,
    assessment_kind: str,
    target_key: str,
) -> tuple[list[dict], int]:
    normalized_kind = assessment_kind.upper()
    if normalized_kind == ASSESSMENT_KIND_TOPIC:
        try:
            chapter_number = int(target_key)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail="Invalid topic assessment key") from exc
        return _find_chapter_quiz(course, chapter_number), chapter_number

    if normalized_kind == ASSESSMENT_KIND_SUBJECT:
        chapters = list((course.content or {}).get("chapters") or [])
        combined: list[dict] = []
        for chapter in chapters:
            if not isinstance(chapter, dict):
                continue
            combined.extend([item for item in (chapter.get("quiz") or []) if isinstance(item, dict)])
        if not combined:
            raise HTTPException(status_code=400, detail="Subject assessment is not ready yet")
        return combined, 0

    raise HTTPException(status_code=400, detail="Unsupported assessment kind")


@router.get("/classrooms/{classroom_id}/practice", response_model=PracticeOverviewOut)
def get_practice_overview(
    classroom_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    classroom = _get_classroom_or_404(db, classroom_id)
    _ensure_view_access(db, current_user, classroom)
    course = _get_or_create_course(db, classroom, current_user)
    course = _bootstrap_practice_content(db, classroom=classroom, course=course)
    return _overview_payload(db, classroom=classroom, course=course, viewer=current_user)


@router.post(
    "/classrooms/{classroom_id}/practice/quizzes/{chapter_number}/attempt",
    response_model=PracticeAttemptOut,
    status_code=status.HTTP_201_CREATED,
)
def submit_practice_quiz_attempt(
    classroom_id: int,
    chapter_number: int,
    payload: PracticeAttemptRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if current_user.role != UserRole.STUDENT:
        raise HTTPException(status_code=403, detail="Only students can submit quiz attempts")
    classroom = _get_classroom_or_404(db, classroom_id)
    _ensure_view_access(db, current_user, classroom)
    _require_student_membership(db, classroom_id, current_user)

    course = _get_course(db, classroom_id)
    if not course:
        raise HTTPException(status_code=404, detail="Practice content not generated yet")
    quiz = _find_chapter_quiz(course, chapter_number)

    correct = 0
    for index, question in enumerate(quiz):
        selected = payload.selected_answers[index] if index < len(payload.selected_answers) else None
        if selected and selected == question.get("correct_answer"):
            correct += 1
    score = (correct / len(quiz) * 100.0) if quiz else 0.0

    attempt = CourseChapterAttempt(
        classroom_id=classroom_id,
        chapter_number=chapter_number,
        user_id=current_user.id,
        attempt_type="QUIZ",
        score=score,
        payload={
            "selected_answers": payload.selected_answers,
            "correct": correct,
            "total": len(quiz),
        },
    )
    db.add(attempt)
    db.commit()
    db.refresh(attempt)
    return attempt


@router.post(
    "/classrooms/{classroom_id}/practice/assessments/{assessment_kind}/{target_key}/attempt",
    response_model=PracticeAttemptOut,
    status_code=status.HTTP_201_CREATED,
)
def submit_practice_assessment_attempt(
    classroom_id: int,
    assessment_kind: str,
    target_key: str,
    payload: PracticeAttemptRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if current_user.role != UserRole.STUDENT:
        raise HTTPException(status_code=403, detail="Only students can submit assessments")
    classroom = _get_classroom_or_404(db, classroom_id)
    _ensure_view_access(db, current_user, classroom)
    _require_student_membership(db, classroom_id, current_user)

    course = _get_course(db, classroom_id)
    if not course:
        raise HTTPException(status_code=404, detail="Practice content not generated yet")

    normalized_kind = assessment_kind.upper()
    is_unlocked = _assessment_lock_map(db, classroom_id).get((normalized_kind, target_key), False)
    if not is_unlocked:
        raise HTTPException(status_code=403, detail="Assessment is locked by the class teacher")

    questions, chapter_number = _find_assessment_questions(
        course=course,
        assessment_kind=assessment_kind,
        target_key=target_key,
    )
    correct = 0
    for index, question in enumerate(questions):
        selected = payload.selected_answers[index] if index < len(payload.selected_answers) else None
        if selected and selected == question.get("correct_answer"):
            correct += 1
    score = (correct / len(questions) * 100.0) if questions else 0.0

    attempt = CourseChapterAttempt(
        classroom_id=classroom_id,
        chapter_number=chapter_number,
        user_id=current_user.id,
        attempt_type=ASSESSMENT_TOPIC if normalized_kind == ASSESSMENT_KIND_TOPIC else ASSESSMENT_SUBJECT,
        score=score,
        payload={
            "target_key": target_key,
            "selected_answers": payload.selected_answers,
            "correct": correct,
            "total": len(questions),
        },
    )
    db.add(attempt)
    db.commit()
    db.refresh(attempt)
    return attempt


@router.patch(
    "/classrooms/{classroom_id}/practice/assessments/{assessment_kind}/{target_key}/lock",
    response_model=PracticeOverviewOut,
)
def set_assessment_lock(
    classroom_id: int,
    assessment_kind: str,
    target_key: str,
    payload: PracticeAssessmentLockRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    normalized_kind = assessment_kind.upper()
    if normalized_kind not in {ASSESSMENT_KIND_TOPIC, ASSESSMENT_KIND_SUBJECT}:
        raise HTTPException(status_code=400, detail="Unsupported assessment kind")

    classroom = _get_classroom_or_404(db, classroom_id)
    _ensure_view_access(db, current_user, classroom)
    _ensure_class_teacher(current_user, classroom)

    course = _get_course(db, classroom_id)
    if not course:
        raise HTTPException(status_code=404, detail="Practice content not generated yet")
    _find_assessment_questions(course=course, assessment_kind=normalized_kind, target_key=target_key)

    lock = (
        db.query(PracticeAssessmentLock)
        .filter(
            PracticeAssessmentLock.classroom_id == classroom_id,
            PracticeAssessmentLock.assessment_kind == normalized_kind,
            PracticeAssessmentLock.target_key == target_key,
        )
        .first()
    )
    if not lock:
        lock = PracticeAssessmentLock(
            classroom_id=classroom_id,
            assessment_kind=normalized_kind,
            target_key=target_key,
            is_unlocked=payload.is_unlocked,
            updated_by_id=current_user.id,
        )
        db.add(lock)
    else:
        lock.is_unlocked = payload.is_unlocked
        lock.updated_by_id = current_user.id
    db.commit()

    return _overview_payload(db, classroom=classroom, course=course, viewer=current_user)
