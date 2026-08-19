from math import ceil
import copy
import logging
import shutil
import threading
import time
import uuid
from pathlib import Path

from fastapi import APIRouter, BackgroundTasks, Depends, File, HTTPException, UploadFile, status
from sqlalchemy.orm import Session
from sqlalchemy.orm.attributes import flag_modified

from app.api.deps import get_current_user
from app.api.routes.classrooms import _ensure_view_access, _get_classroom_or_404
from app.core.database import SessionLocal, get_db
from app.models.classroom import Classroom, ClassroomStudent, MembershipStatus
from app.models.classroom_course import (
    ClassroomCourse,
    CourseChapterAttempt,
    MockExam,
    MockExamAttempt,
    PracticeAssessmentLock,
)
from app.models.content import ClassroomContent
from app.models.user import User, UserRole
from app.services import groq_course
from app.services.mock_exam_gemini import extract_mock_exam_pattern, generate_mock_exam_paper
from app.services.practice_gemini import (
    generate_chapter_scenarios,
    generate_practice_chapters,
    repair_dropped_html_openers,
    valid_mcq_options,
)
from app.services.bloom import resolve_bloom_level
from app.services.source_text import build_documents_source_text
from app.schemas.practice import (
    MockExamAttemptOut,
    MockExamAttemptRequest,
    MockExamCreateRequest,
    MockExamOut,
    MockExamPatternOut,
    MockExamPublishRequest,
    MockExamReviewRequest,
    PracticeAssessmentLockRequest,
    PracticeAssessmentOut,
    PracticeAttemptOut,
    PracticeAttemptRequest,
    PracticeFlashcardDeckOut,
    PracticeFlashcardOut,
    PracticeOverviewOut,
    PracticeQuestionOut,
    PracticeQuizOut,
    PracticeScenarioOut,
    PracticeSummaryOut,
)

router = APIRouter(tags=["practice"])
logger = logging.getLogger(__name__)

ASSESSMENT_TOPIC = "ASSESSMENT_TOPIC"
ASSESSMENT_SUBJECT = "ASSESSMENT_SUBJECT"
ASSESSMENT_KIND_TOPIC = "TOPIC"
ASSESSMENT_KIND_SUBJECT = "SUBJECT"
SUBJECT_TARGET_KEY = "overall"
MOCK_EXAM_UPLOAD_DIR = Path("uploads/mock_exams")

_practice_generation_lock = threading.Lock()
_practice_generation_in_flight: set[int] = set()


def _try_start_practice_generation(classroom_id: int) -> bool:
    with _practice_generation_lock:
        if classroom_id in _practice_generation_in_flight:
            return False
        _practice_generation_in_flight.add(classroom_id)
        return True


def _finish_practice_generation(classroom_id: int) -> None:
    with _practice_generation_lock:
        _practice_generation_in_flight.discard(classroom_id)


def _ensure_class_teacher(user: User, classroom: Classroom) -> None:
    if user.role == UserRole.SUPER_ADMIN:
        return
    if classroom.class_teacher_id != user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only the class teacher can manage assessment access",
        )


def _sanitize_paper_for_student(paper: dict) -> dict:
    """Strip answer keys so students never see correct/expected answers before or after attempt."""
    sections = []
    for section in paper.get("sections") or []:
        if not isinstance(section, dict):
            continue
        questions = []
        for question in section.get("questions") or []:
            if not isinstance(question, dict):
                continue
            safe = {k: v for k, v in question.items() if k not in {"correct_answer", "expected_answer"}}
            questions.append(safe)
        sections.append({**section, "questions": questions})
    return {
        "instructions": paper.get("instructions") or "",
        "sections": sections,
    }


def _mock_exam_out(exam: MockExam, *, viewer: User | None = None) -> MockExamOut:
    payload = MockExamOut.model_validate(exam)
    if viewer is not None and viewer.role == UserRole.STUDENT:
        payload.paper = _sanitize_paper_for_student(exam.paper or {})
    return payload


def _mock_exam_visible_query(db: Session, classroom_id: int, user: User):
    query = db.query(MockExam).filter(MockExam.classroom_id == classroom_id)
    if user.role == UserRole.STUDENT:
        query = query.filter(MockExam.status == "PUBLISHED")
    return query.order_by(MockExam.created_at.desc(), MockExam.id.desc())


def _flatten_mock_questions(paper: dict) -> list[dict]:
    questions: list[dict] = []
    for section in paper.get("sections") or []:
        if not isinstance(section, dict):
            continue
        section_title = str(section.get("title") or "")
        for question in section.get("questions") or []:
            if isinstance(question, dict):
                questions.append({**question, "section_title": question.get("section_title") or section_title})
    return questions


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


def _course_documents(
    db: Session,
    *,
    classroom_id: int,
    source_content_ids: list[int] | None,
) -> list[ClassroomContent]:
    query = (
        db.query(ClassroomContent)
        .filter(
            ClassroomContent.classroom_id == classroom_id,
            ClassroomContent.is_active.is_(True),
        )
    )
    ids = list(source_content_ids or [])
    if ids:
        query = query.filter(ClassroomContent.id.in_(ids))
    return query.order_by(ClassroomContent.created_at.asc()).all()


def _documents_source_text(documents: list[ClassroomContent]) -> str:
    return build_documents_source_text(documents)


def _save_chapters(db: Session, course: ClassroomCourse, chapters: list[dict]) -> None:
    course.content = {"chapters": copy.deepcopy(chapters)}
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


def _chapter_needs_assessments(chapter: dict) -> bool:
    if not isinstance(chapter, dict):
        return False
    return not chapter.get("quiz") or not chapter.get("flashcards")


def _chapter_needs_scenarios(chapter: dict) -> bool:
    if not isinstance(chapter, dict):
        return False
    if "scenarios" not in chapter:
        return True
    scenarios = chapter.get("scenarios") or []
    if not scenarios:
        return True
    for scenario in scenarios:
        if not isinstance(scenario, dict):
            return True
        questions = scenario.get("questions") or []
        if not questions:
            return True
        for question in questions:
            if not isinstance(question, dict) or not valid_mcq_options(question.get("options") or []):
                return True
    return False


def _needs_scenario_fill_in(chapters: list[dict]) -> bool:
    if not chapters:
        return False
    for chapter in chapters:
        if _chapter_needs_scenarios(chapter):
            return True
    return False


def _fill_missing_assessments_groq(
    *,
    classroom_name: str,
    chapters: list[dict],
    document_source_text: str,
    max_chapters: int = 1,
) -> int:
    processed = 0
    for chapter in chapters:
        if processed >= max_chapters:
            break
        if not _chapter_needs_assessments(chapter):
            continue
        assessments = groq_course.generate_chapter_assessments(
            classroom_name=classroom_name,
            chapter=chapter,
            document_source_text=document_source_text,
            include_flashcards=True,
        )
        if assessments.get("quiz"):
            chapter["quiz"] = assessments["quiz"]
        if assessments.get("flashcards"):
            chapter["flashcards"] = assessments["flashcards"]
        if "scenarios" not in chapter:
            chapter["scenarios"] = assessments.get("scenarios") or []
        processed += 1
    return processed


def _bootstrap_practice_background(classroom_id: int) -> None:
    try:
        db = SessionLocal()
        try:
            classroom = db.query(Classroom).filter(Classroom.id == classroom_id).first()
            if not classroom:
                return
            course = _get_course(db, classroom_id)
            if not course:
                return
            classroom_name = classroom.name
            documents = _course_documents(
                db,
                classroom_id=classroom_id,
                source_content_ids=course.source_content_ids,
            )
            document_source_text = _documents_source_text(documents)
            chapters = list((course.content or {}).get("chapters") or [])
        finally:
            db.close()

        if not document_source_text.strip():
            return

        if not chapters:
            try:
                generated = generate_practice_chapters(
                    classroom_name=classroom_name,
                    documents=documents,
                )
            except Exception as exc:
                logger.warning(
                    "Background practice generation skipped for classroom %s: %s",
                    classroom_id,
                    exc,
                )
                return
            if not generated:
                return
            db = SessionLocal()
            try:
                course = _get_course(db, classroom_id)
                if not course:
                    return
                _save_chapters(db, course, generated)
            finally:
                db.close()

        for _ in range(8):
            db = SessionLocal()
            try:
                course = _get_course(db, classroom_id)
                if not course:
                    return
                chapters = list((course.content or {}).get("chapters") or [])
                if not any(_chapter_needs_assessments(chapter) for chapter in chapters if isinstance(chapter, dict)):
                    break
                target = next(
                    (chapter for chapter in chapters if isinstance(chapter, dict) and _chapter_needs_assessments(chapter)),
                    None,
                )
                if not target:
                    break
                chapter_number = int(target.get("chapter") or 0)
            finally:
                db.close()

            try:
                assessments = groq_course.generate_chapter_assessments(
                    classroom_name=classroom_name,
                    chapter=target,
                    document_source_text=document_source_text,
                    include_flashcards=True,
                )
            except Exception as exc:
                logger.warning(
                    "Groq practice fill skipped for classroom %s chapter %s: %s",
                    classroom_id,
                    chapter_number,
                    exc,
                )
                break

            if not assessments.get("quiz") and not assessments.get("flashcards"):
                break

            if assessments.get("quiz"):
                target["quiz"] = assessments["quiz"]
            if assessments.get("flashcards"):
                target["flashcards"] = assessments["flashcards"]
            scenario_items = assessments.get("scenarios") or []
            if _chapter_needs_scenarios(target):
                target["scenarios"] = scenario_items
            elif "scenarios" not in target:
                target["scenarios"] = scenario_items

            db = SessionLocal()
            try:
                course = _get_course(db, classroom_id)
                if not course:
                    return
                chapters = list((course.content or {}).get("chapters") or [])
                for index, chapter in enumerate(chapters):
                    if isinstance(chapter, dict) and int(chapter.get("chapter") or 0) == chapter_number:
                        chapters[index] = target
                        break
                _save_chapters(db, course, chapters)
            finally:
                db.close()
            time.sleep(0.5)

        for _ in range(8):
            db = SessionLocal()
            try:
                classroom = db.query(Classroom).filter(Classroom.id == classroom_id).first()
                course = _get_course(db, classroom_id)
                if not classroom or not course:
                    return
                chapters = list((course.content or {}).get("chapters") or [])
                if not _needs_scenario_fill_in(chapters):
                    return
                target = next(
                    (
                        chapter
                        for chapter in chapters
                        if isinstance(chapter, dict) and _chapter_needs_scenarios(chapter)
                    ),
                    None,
                )
                if not target:
                    return
                chapter_number = int(target.get("chapter") or 0)
                documents = _course_documents(
                    db,
                    classroom_id=classroom_id,
                    source_content_ids=course.source_content_ids,
                )
                document_source_text = _documents_source_text(documents)
            finally:
                db.close()

            if not document_source_text.strip():
                return

            scenarios: list[dict] = []
            try:
                assessments = groq_course.generate_chapter_assessments(
                    classroom_name=classroom_name,
                    chapter=target,
                    document_source_text=document_source_text,
                    include_flashcards=False,
                )
                scenarios = assessments.get("scenarios") or []
            except Exception as exc:
                logger.warning(
                    "Groq scenario generation skipped for classroom %s chapter %s: %s",
                    classroom_id,
                    chapter_number,
                    exc,
                )
            if not scenarios:
                try:
                    scenarios = generate_chapter_scenarios(
                        classroom_name=classroom_name,
                        chapter=target,
                        documents=documents,
                    )
                except Exception as exc:
                    logger.warning(
                        "Scenario generation skipped for classroom %s chapter %s: %s",
                        classroom_id,
                        chapter_number,
                        exc,
                    )
                    scenarios = []

            db = SessionLocal()
            try:
                course = _get_course(db, classroom_id)
                if not course:
                    return
                chapters = list((course.content or {}).get("chapters") or [])
                for index, chapter in enumerate(chapters):
                    if isinstance(chapter, dict) and int(chapter.get("chapter") or 0) == chapter_number:
                        chapters[index]["scenarios"] = scenarios
                        break
                _save_chapters(db, course, chapters)
            finally:
                db.close()
            time.sleep(0.5)
    finally:
        _finish_practice_generation(classroom_id)


def _fill_missing_scenarios(
    db: Session,
    *,
    classroom: Classroom,
    course: ClassroomCourse,
    documents: list[ClassroomContent],
    max_chapters: int = 1,
) -> None:
    chapters = list((course.content or {}).get("chapters") or [])
    changed = False
    processed = 0
    for chapter in chapters:
        if processed >= max_chapters:
            break
        if not isinstance(chapter, dict) or "scenarios" in chapter:
            continue
        processed += 1
        scenarios: list[dict] = []
        try:
            scenarios = generate_chapter_scenarios(
                classroom_name=classroom.name,
                chapter=chapter,
                documents=documents,
            )
        except Exception as exc:
            logger.warning(
                "Scenario generation skipped for classroom %s chapter %s: %s",
                classroom.id,
                chapter.get("chapter"),
                exc,
            )
        chapter["scenarios"] = scenarios
        changed = True
    if changed:
        _save_chapters(db, course, chapters)


def _fill_missing_scenarios_background(classroom_id: int) -> None:
    db = SessionLocal()
    try:
        classroom = db.query(Classroom).filter(Classroom.id == classroom_id).first()
        if not classroom:
            return
        course = _get_course(db, classroom_id)
        if not course:
            return
        chapters = list((course.content or {}).get("chapters") or [])
        if not _needs_scenario_fill_in(chapters):
            return
        documents = _active_documents(db, classroom_id)
        _fill_missing_scenarios(
            db,
            classroom=classroom,
            course=course,
            documents=documents,
            max_chapters=1,
        )
    finally:
        db.close()


def _bootstrap_practice_content(
    db: Session,
    *,
    classroom: Classroom,
    course: ClassroomCourse,
) -> tuple[ClassroomCourse, bool]:
    documents = _active_documents(db, classroom.id)
    if not documents:
        return course, False

    document_ids = [document.id for document in documents]
    source_changed = document_ids != list(course.source_content_ids or [])
    if source_changed:
        course.source_content_ids = document_ids
        db.commit()
        db.refresh(course)

    chapters = list((course.content or {}).get("chapters") or [])
    if not _needs_practice_regeneration(chapters, source_changed=source_changed):
        return course, False

    return course, True


def _estimate_minutes(question_count: int, *, seconds_per_question: int) -> int:
    if question_count <= 0:
        return 0
    return max(5, ceil((question_count * seconds_per_question) / 60))


def _repair_question_html(question: dict) -> bool:
    changed = False
    for key in ("question", "correct_answer"):
        raw = str(question.get(key) or "")
        fixed = repair_dropped_html_openers(raw)
        if fixed != raw:
            question[key] = fixed
            changed = True
    options = question.get("options")
    if isinstance(options, list):
        repaired = [repair_dropped_html_openers(str(option)) for option in options]
        if repaired != options:
            question["options"] = repaired
            changed = True
    return changed


def _persist_repaired_html(db: Session, course: ClassroomCourse) -> None:
    content = course.content
    if not isinstance(content, dict):
        return
    changed = False
    for chapter in content.get("chapters") or []:
        if not isinstance(chapter, dict):
            continue
        for question in chapter.get("quiz") or []:
            if isinstance(question, dict) and _repair_question_html(question):
                changed = True
        for scenario in chapter.get("scenarios") or []:
            if not isinstance(scenario, dict):
                continue
            for question in scenario.get("questions") or []:
                if isinstance(question, dict) and _repair_question_html(question):
                    changed = True
    if not changed:
        return
    course.content = content
    flag_modified(course, "content")
    db.add(course)
    db.commit()
    db.refresh(course)


def _answers_match(selected: str | None, correct: str | None) -> bool:
    if not selected or not correct:
        return False
    if selected == correct:
        return True
    return repair_dropped_html_openers(selected) == repair_dropped_html_openers(correct)


def _topic_label(chapter: dict) -> str:
    topics = [str(item).strip() for item in (chapter.get("topics") or []) if str(item).strip()]
    return topics[0] if topics else f"Chapter {int(chapter.get('chapter') or 0)}"


def _question_out_list(items: list[dict]) -> list[PracticeQuestionOut]:
    result: list[PracticeQuestionOut] = []
    for item in items:
        if not isinstance(item, dict):
            continue
        question = repair_dropped_html_openers(str(item.get("question") or "").strip())
        options = [
            repair_dropped_html_openers(str(option).strip())
            for option in (item.get("options") or [])
            if str(option).strip()
        ]
        if question and options:
            level = resolve_bloom_level(question, item.get("bloom_level"))
            result.append(
                PracticeQuestionOut(
                    question=question,
                    options=options,
                    bloom_level=level.value,
                )
            )
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
        elif attempt_type == "SCENARIO":
            key = str(row.payload.get("scenario_id") or "")
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
    generation_pending: bool = False,
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
            generation_status="idle",
            summary=PracticeSummaryOut(source_document_count=source_document_count),
            quizzes=[],
            flashcard_decks=[],
            scenarios=[],
            topic_assessments=[],
            subject_assessments=[],
        )

    quiz_attempts = _latest_attempt_map(
        db,
        classroom_id=classroom.id,
        user_id=viewer.id,
        attempt_type="QUIZ",
    )
    scenario_attempts = _latest_attempt_map(
        db,
        classroom_id=classroom.id,
        user_id=viewer.id,
        attempt_type="SCENARIO",
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
    scenarios: list[PracticeScenarioOut] = []
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

        scenarios_raw = [item for item in (chapter.get("scenarios") or []) if isinstance(item, dict)]
        for scenario_index, scenario in enumerate(scenarios_raw, start=1):
            scenario_id = str(scenario.get("id") or f"chapter-{chapter_number}-scenario-{scenario_index}").strip()
            scenario_title = str(scenario.get("title") or f"Scenario {scenario_index}").strip()
            situation = str(scenario.get("situation") or "").strip()
            scenario_questions = _question_out_list(
                [
                    item
                    for item in (scenario.get("questions") or [])
                    if isinstance(item, dict) and valid_mcq_options(item.get("options") or [])
                ]
            )
            if not scenario_id or not scenario_title or not situation or not scenario_questions:
                continue
            latest_scenario_attempt = scenario_attempts.get(scenario_id)
            scenarios.append(
                PracticeScenarioOut(
                    id=scenario_id,
                    chapter_number=chapter_number,
                    chapter_title=chapter_title,
                    title=scenario_title,
                    situation=situation,
                    question_count=len(scenario_questions),
                    latest_score=latest_scenario_attempt.score if latest_scenario_attempt else None,
                    latest_attempted_at=latest_scenario_attempt.created_at if latest_scenario_attempt else None,
                    questions=scenario_questions,
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
        ready_scenarios=len(scenarios),
        locked_assessments=sum(1 for item in [*topic_assessments, *subject_assessments] if item.is_locked),
        completed_quizzes=sum(1 for item in quizzes if item.latest_score is not None),
        completed_scenarios=sum(1 for item in scenarios if item.latest_score is not None),
        completed_assessments=sum(
            1 for item in [*topic_assessments, *subject_assessments] if item.latest_score is not None
        ),
    )
    has_practice_content = bool(quizzes or flashcard_decks or scenarios)
    if generation_pending and not has_practice_content:
        generation_status = "generating"
        generation_message = (
            "Practice content is being generated from your classroom material. "
            "This page will refresh automatically."
        )
    elif generation_pending:
        generation_status = "generating"
        generation_message = "More practice content is still being generated. Refresh to load new chapters."
    elif has_practice_content:
        generation_status = "ready"
        generation_message = None
    else:
        generation_status = "idle"
        generation_message = None

    return PracticeOverviewOut(
        classroom_id=classroom.id,
        classroom_name=classroom.name,
        course_title=course.title,
        source_document_count=source_document_count,
        generation_status=generation_status,
        generation_message=generation_message,
        summary=summary,
        quizzes=quizzes,
        flashcard_decks=flashcard_decks,
        scenarios=scenarios,
        topic_assessments=topic_assessments,
        subject_assessments=subject_assessments,
    )


def _find_chapter_scenario(
    course: ClassroomCourse,
    chapter_number: int,
    scenario_id: str,
) -> list[dict]:
    chapters = list((course.content or {}).get("chapters") or [])
    target = next((chapter for chapter in chapters if int(chapter.get("chapter") or 0) == chapter_number), None)
    if not target:
        raise HTTPException(status_code=404, detail="Chapter not found")
    scenarios = [item for item in (target.get("scenarios") or []) if isinstance(item, dict)]
    scenario = next((item for item in scenarios if str(item.get("id") or "") == scenario_id), None)
    if not scenario:
        raise HTTPException(status_code=404, detail="Scenario not found")
    questions = [item for item in (scenario.get("questions") or []) if isinstance(item, dict)]
    if not questions:
        raise HTTPException(status_code=400, detail="Scenario is not ready yet")
    return questions


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
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    classroom = _get_classroom_or_404(db, classroom_id)
    _ensure_view_access(db, current_user, classroom)
    course = _get_or_create_course(db, classroom, current_user)
    course, generation_pending = _bootstrap_practice_content(db, classroom=classroom, course=course)
    _persist_repaired_html(db, course)
    chapters = list((course.content or {}).get("chapters") or [])
    needs_background = generation_pending or _needs_scenario_fill_in(chapters)
    if needs_background and _try_start_practice_generation(classroom_id):
        background_tasks.add_task(_bootstrap_practice_background, classroom_id)
    elif needs_background:
        generation_pending = True
    return _overview_payload(
        db,
        classroom=classroom,
        course=course,
        viewer=current_user,
        generation_pending=generation_pending,
    )


@router.post("/classrooms/{classroom_id}/practice/mock-exams/pattern", response_model=MockExamPatternOut)
def extract_mock_pattern(
    classroom_id: int,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    classroom = _get_classroom_or_404(db, classroom_id)
    _ensure_view_access(db, current_user, classroom)
    _ensure_class_teacher(current_user, classroom)

    mime_type = file.content_type or "application/octet-stream"
    if mime_type not in {"application/pdf", "image/png", "image/jpeg", "image/webp"}:
        raise HTTPException(status_code=400, detail="Upload a PDF or image PYQ")

    MOCK_EXAM_UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
    suffix = Path(file.filename or "pyq").suffix or ".pdf"
    stored = MOCK_EXAM_UPLOAD_DIR / f"{uuid.uuid4().hex}{suffix}"
    with stored.open("wb") as out:
        shutil.copyfileobj(file.file, out)

    try:
        pattern = extract_mock_exam_pattern(
            file_path=str(stored),
            mime_type=mime_type,
            fallback_title=Path(file.filename or "Mock Exam").stem or "Mock Exam",
        )
    except Exception as exc:
        logger.warning("Mock exam pattern extraction failed for classroom %s: %s", classroom.id, exc)
        detail = str(exc).strip() or "Could not extract PYQ pattern."
        if "quota" in detail.lower() or "429" in detail:
            detail = (
                "Gemini quota/rate limit reached. Wait a bit, switch GEMINI_CHAT_MODEL "
                "(for example gemini-3.6-flash or gemini-flash-latest), or add another API key in backend/.env."
            )
        elif "DUMMY_KEY" in detail or "api key" in detail.lower():
            detail = "Gemini API key is missing. Set GEMINI_API_KEY in backend/.env and restart the API."
        else:
            detail = f"Could not extract PYQ pattern. {detail}"
        raise HTTPException(status_code=502, detail=detail) from exc
    return MockExamPatternOut(
        **pattern,
        pyq_file_name=file.filename,
        pyq_file_path=str(stored),
    )


@router.post("/classrooms/{classroom_id}/practice/mock-exams", response_model=MockExamOut, status_code=status.HTTP_201_CREATED)
def create_mock_exam(
    classroom_id: int,
    payload: MockExamCreateRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    classroom = _get_classroom_or_404(db, classroom_id)
    _ensure_view_access(db, current_user, classroom)
    _ensure_class_teacher(current_user, classroom)
    course = _get_or_create_course(db, classroom, current_user)
    documents = _active_documents(db, classroom.id)

    exam = MockExam(
        classroom_id=classroom.id,
        created_by_id=current_user.id,
        title=payload.title.strip() or "Mock Exam",
        total_marks=payload.total_marks,
        duration_minutes=payload.duration_minutes,
        pattern=payload.pattern,
        pyq_file_name=payload.pyq_file_name,
        pyq_file_path=payload.pyq_file_path,
        status="DRAFT",
    )
    db.add(exam)
    db.flush()

    try:
        paper = generate_mock_exam_paper(
            classroom_name=classroom.name,
            pattern=payload.pattern,
            syllabus_text=course.syllabus_text,
            syllabus_path=course.syllabus_file_path,
            syllabus_name=course.syllabus_file_name,
            documents=documents,
        )
        exam.paper = paper
        exam.error_message = None
    except Exception as exc:
        logger.warning("Mock exam generation failed for classroom %s: %s", classroom.id, exc)
        exam.paper = {"instructions": "", "sections": []}
        detail = str(exc).strip()
        if "quota" in detail.lower() or "429" in detail:
            exam.error_message = (
                "Gemini quota/rate limit reached while generating the paper. "
                "Retry shortly or switch GEMINI_CHAT_MODEL to gemini-3.6-flash / gemini-flash-latest."
            )
        else:
            exam.error_message = (
                f"Could not generate mock exam. {detail[:240]}"
                if detail
                else "Could not generate mock exam. Check Gemini configuration and source material."
            )

    db.commit()
    db.refresh(exam)
    return _mock_exam_out(exam, viewer=current_user)


@router.post("/classrooms/{classroom_id}/practice/mock-exams/{exam_id}/regenerate", response_model=MockExamOut)
def regenerate_mock_exam(
    classroom_id: int,
    exam_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    classroom = _get_classroom_or_404(db, classroom_id)
    _ensure_view_access(db, current_user, classroom)
    _ensure_class_teacher(current_user, classroom)
    exam = db.query(MockExam).filter(MockExam.id == exam_id, MockExam.classroom_id == classroom_id).first()
    if not exam:
        raise HTTPException(status_code=404, detail="Mock exam not found")
    if exam.status == "PUBLISHED":
        raise HTTPException(status_code=400, detail="Unpublish the mock exam before regenerating")

    course = _get_or_create_course(db, classroom, current_user)
    documents = _active_documents(db, classroom.id)
    try:
        paper = generate_mock_exam_paper(
            classroom_name=classroom.name,
            pattern=exam.pattern or {},
            syllabus_text=course.syllabus_text,
            syllabus_path=course.syllabus_file_path,
            syllabus_name=course.syllabus_file_name,
            documents=documents,
        )
        exam.paper = paper
        exam.error_message = None
    except Exception as exc:
        logger.warning("Mock exam regenerate failed for classroom %s exam %s: %s", classroom.id, exam.id, exc)
        exam.paper = {"instructions": "", "sections": []}
        detail = str(exc).strip()
        if "quota" in detail.lower() or "429" in detail:
            exam.error_message = (
                "Gemini quota/rate limit reached while regenerating the paper. "
                "Retry shortly or switch GEMINI_CHAT_MODEL."
            )
        else:
            exam.error_message = (
                f"Could not regenerate mock exam. {detail[:240]}"
                if detail
                else "Could not regenerate mock exam. Check Gemini configuration and source material."
            )

    db.commit()
    db.refresh(exam)
    return _mock_exam_out(exam, viewer=current_user)


@router.get("/classrooms/{classroom_id}/practice/mock-exams", response_model=list[MockExamOut])
def list_mock_exams(
    classroom_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    classroom = _get_classroom_or_404(db, classroom_id)
    _ensure_view_access(db, current_user, classroom)
    return [
        _mock_exam_out(exam, viewer=current_user)
        for exam in _mock_exam_visible_query(db, classroom_id, current_user).all()
    ]


@router.patch("/classrooms/{classroom_id}/practice/mock-exams/{exam_id}/publish", response_model=MockExamOut)
def publish_mock_exam(
    classroom_id: int,
    exam_id: int,
    payload: MockExamPublishRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    classroom = _get_classroom_or_404(db, classroom_id)
    _ensure_view_access(db, current_user, classroom)
    _ensure_class_teacher(current_user, classroom)
    exam = db.query(MockExam).filter(MockExam.id == exam_id, MockExam.classroom_id == classroom_id).first()
    if not exam:
        raise HTTPException(status_code=404, detail="Mock exam not found")
    if payload.is_published and not _flatten_mock_questions(exam.paper or {}):
        raise HTTPException(status_code=400, detail="Cannot publish an empty mock exam")
    if payload.is_published and exam.error_message:
        raise HTTPException(status_code=400, detail="Cannot publish a mock exam that failed generation")
    exam.status = "PUBLISHED" if payload.is_published else "DRAFT"
    db.commit()
    db.refresh(exam)
    return _mock_exam_out(exam, viewer=current_user)


@router.post(
    "/classrooms/{classroom_id}/practice/mock-exams/{exam_id}/attempt",
    response_model=MockExamAttemptOut,
    status_code=status.HTTP_201_CREATED,
)
def submit_mock_exam_attempt(
    classroom_id: int,
    exam_id: int,
    payload: MockExamAttemptRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if current_user.role != UserRole.STUDENT:
        raise HTTPException(status_code=403, detail="Only students can submit mock exams")
    classroom = _get_classroom_or_404(db, classroom_id)
    _ensure_view_access(db, current_user, classroom)
    _require_student_membership(db, classroom_id, current_user)
    exam = db.query(MockExam).filter(MockExam.id == exam_id, MockExam.classroom_id == classroom_id).first()
    if not exam or exam.status != "PUBLISHED":
        raise HTTPException(status_code=404, detail="Mock exam not found")

    mcq_total = 0.0
    mcq_scored = 0.0
    theory_marks = 0.0
    for question in _flatten_mock_questions(exam.paper or {}):
        qid = str(question.get("id") or "")
        qtype = str(question.get("question_type") or "").upper()
        marks = float(question.get("marks") or 0)
        if qtype == "MCQ" and question.get("correct_answer"):
            mcq_total += marks
            if payload.answers.get(qid) == question.get("correct_answer"):
                mcq_scored += marks
        else:
            theory_marks += marks

    attempt = MockExamAttempt(
        mock_exam_id=exam.id,
        classroom_id=classroom_id,
        student_id=current_user.id,
        answers=payload.answers,
        mcq_score=mcq_scored,
        theory_score=None,
        total_score=mcq_scored if theory_marks <= 0 else None,
        theory_status="REVIEWED" if theory_marks <= 0 else "PENDING_REVIEW",
    )
    db.add(attempt)
    db.commit()
    db.refresh(attempt)
    return attempt


@router.get("/classrooms/{classroom_id}/practice/mock-exams/{exam_id}/attempts", response_model=list[MockExamAttemptOut])
def list_mock_exam_attempts(
    classroom_id: int,
    exam_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    classroom = _get_classroom_or_404(db, classroom_id)
    _ensure_view_access(db, current_user, classroom)
    exam = db.query(MockExam).filter(MockExam.id == exam_id, MockExam.classroom_id == classroom_id).first()
    if not exam:
        raise HTTPException(status_code=404, detail="Mock exam not found")
    query = db.query(MockExamAttempt).filter(MockExamAttempt.mock_exam_id == exam_id)
    if current_user.role == UserRole.STUDENT:
        query = query.filter(MockExamAttempt.student_id == current_user.id)
    else:
        _ensure_class_teacher(current_user, classroom)
    return query.order_by(MockExamAttempt.submitted_at.desc()).all()


@router.patch(
    "/classrooms/{classroom_id}/practice/mock-exams/{exam_id}/attempts/{attempt_id}/review",
    response_model=MockExamAttemptOut,
)
def review_mock_exam_attempt(
    classroom_id: int,
    exam_id: int,
    attempt_id: int,
    payload: MockExamReviewRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    classroom = _get_classroom_or_404(db, classroom_id)
    _ensure_view_access(db, current_user, classroom)
    _ensure_class_teacher(current_user, classroom)
    attempt = (
        db.query(MockExamAttempt)
        .filter(
            MockExamAttempt.id == attempt_id,
            MockExamAttempt.mock_exam_id == exam_id,
            MockExamAttempt.classroom_id == classroom_id,
        )
        .first()
    )
    if not attempt:
        raise HTTPException(status_code=404, detail="Attempt not found")
    attempt.theory_score = payload.theory_score
    attempt.total_score = float(attempt.mcq_score or 0) + float(payload.theory_score or 0)
    attempt.theory_status = "REVIEWED"
    attempt.feedback = payload.feedback
    from datetime import datetime, timezone

    attempt.reviewed_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(attempt)
    return attempt


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
        if selected and _answers_match(selected, question.get("correct_answer")):
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
    "/classrooms/{classroom_id}/practice/scenarios/{chapter_number}/{scenario_id}/attempt",
    response_model=PracticeAttemptOut,
    status_code=status.HTTP_201_CREATED,
)
def submit_practice_scenario_attempt(
    classroom_id: int,
    chapter_number: int,
    scenario_id: str,
    payload: PracticeAttemptRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if current_user.role != UserRole.STUDENT:
        raise HTTPException(status_code=403, detail="Only students can submit scenario attempts")
    classroom = _get_classroom_or_404(db, classroom_id)
    _ensure_view_access(db, current_user, classroom)
    _require_student_membership(db, classroom_id, current_user)

    course = _get_course(db, classroom_id)
    if not course:
        raise HTTPException(status_code=404, detail="Practice content not generated yet")
    questions = _find_chapter_scenario(course, chapter_number, scenario_id)

    correct = 0
    for index, question in enumerate(questions):
        selected = payload.selected_answers[index] if index < len(payload.selected_answers) else None
        if selected and _answers_match(selected, question.get("correct_answer")):
            correct += 1
    score = (correct / len(questions) * 100.0) if questions else 0.0

    attempt = CourseChapterAttempt(
        classroom_id=classroom_id,
        chapter_number=chapter_number,
        user_id=current_user.id,
        attempt_type="SCENARIO",
        score=score,
        payload={
            "scenario_id": scenario_id,
            "selected_answers": payload.selected_answers,
            "correct": correct,
            "total": len(questions),
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
        if selected and _answers_match(selected, question.get("correct_answer")):
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
