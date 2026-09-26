import secrets
import string
from fastapi import APIRouter, Depends, Header, HTTPException
from jose import JWTError, jwt
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.database import get_db
from app.core.security import create_access_token, get_password_hash, verify_password
from app.deps import get_current_user, require_teacher
from app.models import (
    AssignmentStatus,
    BloomLevel,
    TheoryTest,
    TheoryTestQuestion,
    SubjectArea,
    Question,
    QuestionType,
    TestAssignment,
    User,
    UserRole,
)
from app.schemas import (
    AssignByEmailRequest,
    AssignmentOut,
    AuthResponse,
    LoginRequest,
    QuestionCreate,
    QuestionDraftOut,
    QuestionGenerateRequest,
    QuestionOut,
    QuestionUpdate,
    RegisterRequest,
    RubricCriterion,
    TestCreate,
    TestOut,
    TestQuestionOut,
    UserOut,
)
from app.services.bloom import (
    difficulty_from_bloom,
    normalize_rubric,
    question_rubric,
    resolve_bloom,
)
from app.services.question_bank import STARTER_QUESTIONS
from app.services.question_generator import generate_question_draft

router = APIRouter(prefix="/auth", tags=["auth"])
teacher_router = APIRouter(prefix="/teacher", tags=["teacher"])

INVITE_ALPHABET = string.ascii_uppercase + string.digits


class SyncUserRequest(BaseModel):
    full_name: str = Field(min_length=2, max_length=200)
    email: str = Field(min_length=5, max_length=255)
    hashed_password: str = Field(min_length=20)
    role: UserRole
    is_active: bool = True


class SsoExchangeRequest(BaseModel):
    token: str = Field(min_length=10)


def _upsert_synced_user(
    db: Session,
    *,
    full_name: str,
    email: str,
    hashed_password: str,
    role: UserRole,
    is_active: bool = True,
) -> User:
    email_norm = email.lower().strip()
    user = db.query(User).filter(User.email == email_norm).first()
    if user:
        user.full_name = full_name.strip()
        user.hashed_password = hashed_password
        user.role = role
        user.is_active = is_active
    else:
        user = User(
            full_name=full_name.strip(),
            email=email_norm,
            hashed_password=hashed_password,
            role=role,
            is_active=is_active,
        )
        db.add(user)
    db.commit()
    db.refresh(user)
    return user


@router.post("/sync-user", response_model=UserOut)
def sync_user(
    payload: SyncUserRequest,
    db: Session = Depends(get_db),
    x_theory_sync_secret: str | None = Header(default=None),
):
    if not settings.theory_sync_secret or x_theory_sync_secret != settings.theory_sync_secret:
        raise HTTPException(status_code=401, detail="Invalid sync secret")
    if payload.role not in {UserRole.TEACHER, UserRole.STUDENT}:
        raise HTTPException(status_code=400, detail="Role must be TEACHER or STUDENT")
    user = _upsert_synced_user(
        db,
        full_name=payload.full_name,
        email=payload.email,
        hashed_password=payload.hashed_password,
        role=payload.role,
        is_active=payload.is_active,
    )
    return UserOut.model_validate(user)


@router.post("/sso", response_model=AuthResponse)
def sso_exchange(payload: SsoExchangeRequest, db: Session = Depends(get_db)):
    try:
        claims = jwt.decode(
            payload.token,
            settings.astra_sso_secret,
            algorithms=[settings.jwt_algorithm],
        )
    except JWTError as exc:
        raise HTTPException(status_code=401, detail="Invalid SSO token") from exc

    if claims.get("type") != "coding_sso":
        raise HTTPException(status_code=401, detail="Invalid SSO token type")

    email = (claims.get("email") or "").lower().strip()
    full_name = (claims.get("full_name") or "").strip() or email
    astra_role = (claims.get("astra_role") or "").upper()
    if not email:
        raise HTTPException(status_code=400, detail="SSO token missing identity")

    if astra_role in {"CLASS_TEACHER", "SUBJECT_TEACHER"}:
        role = UserRole.TEACHER
    elif astra_role == "STUDENT":
        role = UserRole.STUDENT
    else:
        raise HTTPException(status_code=403, detail="Role cannot use theory platform")

    user = db.query(User).filter(User.email == email).first()
    if not user:
        # Identity should already be synced from ASTRA before SSO.
        raise HTTPException(
            status_code=404,
            detail="User not found on theory platform — sign in to ASTRA again",
        )
    user.full_name = full_name
    user.role = role
    user.is_active = True
    db.commit()
    db.refresh(user)

    token = create_access_token(str(user.id), user.role.value)
    return AuthResponse(access_token=token, user=UserOut.model_validate(user))


@router.post("/register", response_model=AuthResponse)
def register(payload: RegisterRequest, db: Session = Depends(get_db)):
    exists = db.query(User).filter(User.email == payload.email.lower()).first()
    if exists:
        raise HTTPException(status_code=400, detail="Email already registered")
    user = User(
        full_name=payload.full_name.strip(),
        email=payload.email.lower().strip(),
        hashed_password=get_password_hash(payload.password),
        role=payload.role,
        is_active=True,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    token = create_access_token(str(user.id), user.role.value)
    return AuthResponse(access_token=token, user=UserOut.model_validate(user))


@router.post("/login", response_model=AuthResponse)
def login(payload: LoginRequest, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.email == payload.email.lower().strip()).first()
    if not user or not verify_password(payload.password, user.hashed_password):
        raise HTTPException(status_code=401, detail="Invalid email or password")
    token = create_access_token(str(user.id), user.role.value)
    return AuthResponse(access_token=token, user=UserOut.model_validate(user))


@router.get("/me", response_model=UserOut)
def me(user: User = Depends(get_current_user)):
    return UserOut.model_validate(user)


def _question_out(q: Question) -> QuestionOut:
    return QuestionOut(
        id=q.id,
        title=q.title,
        prompt_markdown=q.prompt_markdown,
        model_answer=q.model_answer or "",
        subject=q.subject,
        bloom_level=resolve_bloom(q),
        rubric=[RubricCriterion.model_validate(item) for item in question_rubric(q)],
        source_prompt=getattr(q, "source_prompt", None),
        created_by_id=q.created_by_id,
        is_active=q.is_active,
    )


def _invite_code(db: Session) -> str:
    for _ in range(30):
        code = "".join(secrets.choice(INVITE_ALPHABET) for _ in range(6))
        if not db.query(TheoryTest).filter(TheoryTest.invite_code == code).first():
            return code
    raise HTTPException(status_code=500, detail="Could not generate invite code")


def _test_out(test: TheoryTest) -> TestOut:
    links = sorted(test.questions, key=lambda item: item.order_index)
    return TestOut(
        id=test.id,
        title=test.title,
        duration_minutes=test.duration_minutes,
        invite_code=test.invite_code,
        is_published_results=test.is_published_results,
        created_by_id=test.created_by_id,
        questions=[
            TestQuestionOut(
                order_index=link.order_index,
                bloom_level=resolve_bloom(link.question, getattr(link, "required_difficulty", None)),
                question=_question_out(link.question),
            )
            for link in links
        ],
    )


@teacher_router.post("/questions", response_model=QuestionOut)
def create_question(
    payload: QuestionCreate,
    db: Session = Depends(get_db),
    teacher: User = Depends(require_teacher),
):
    rubric = normalize_rubric([item.model_dump() for item in payload.rubric])
    q = Question(
        title=payload.title.strip(),
        prompt_markdown=payload.prompt_markdown,
        model_answer=payload.model_answer or "",
        subject=payload.subject,
        bloom_level=payload.bloom_level,
        difficulty=difficulty_from_bloom(payload.bloom_level),
        question_type=QuestionType.SYLLABUS,
        rubric_json=rubric,
        source_prompt=(payload.source_prompt or "").strip() or None,
        created_by_id=teacher.id,
        is_active=True,
    )
    db.add(q)
    db.commit()
    db.refresh(q)
    return _question_out(q)


@teacher_router.post("/questions/generate", response_model=QuestionDraftOut)
def generate_question(
    payload: QuestionGenerateRequest,
    teacher: User = Depends(require_teacher),
):
    _ = teacher.id
    try:
        draft = generate_question_draft(
            topic_or_scenario=payload.topic_or_scenario,
            bloom_level=payload.bloom_level,
            subject=payload.subject,
        )
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=502, detail=f"Question generation failed: {exc}") from exc
    return QuestionDraftOut(
        title=draft["title"],
        prompt_markdown=draft["prompt_markdown"],
        model_answer=draft["model_answer"],
        bloom_level=draft["bloom_level"],
        subject=draft["subject"],
        rubric=[RubricCriterion.model_validate(item) for item in draft["rubric"]],
        source_prompt=draft.get("source_prompt"),
    )


@teacher_router.post("/questions/import-all", response_model=list[QuestionOut])
def import_all_questions(
    db: Session = Depends(get_db),
    teacher: User = Depends(require_teacher),
):
    """Copy starter catalog + any other teachers' questions into this teacher's bank."""
    existing_keys = {
        (q.title.strip().lower(), q.subject, resolve_bloom(q))
        for q in db.query(Question).filter(Question.created_by_id == teacher.id).all()
    }

    imported: list[Question] = []

    def _add(
        *,
        title: str,
        prompt_markdown: str,
        model_answer: str,
        subject: SubjectArea,
        bloom_level: BloomLevel,
        rubric_json: list | None = None,
        source_prompt: str | None = None,
    ) -> None:
        key = (title.strip().lower(), subject, bloom_level)
        if key in existing_keys:
            return
        row = Question(
            title=title.strip(),
            prompt_markdown=prompt_markdown,
            model_answer=model_answer or "",
            subject=subject,
            bloom_level=bloom_level,
            difficulty=difficulty_from_bloom(bloom_level),
            question_type=QuestionType.SYLLABUS,
            rubric_json=normalize_rubric(rubric_json),
            source_prompt=source_prompt,
            created_by_id=teacher.id,
            is_active=True,
        )
        db.add(row)
        imported.append(row)
        existing_keys.add(key)

    for title, lang, bloom, prompt, starter, rubric in STARTER_QUESTIONS:
        _add(
            title=title,
            prompt_markdown=prompt,
            model_answer=starter,
            subject=lang,
            bloom_level=bloom,
            rubric_json=rubric,
        )

    # Clone questions created by other teachers on this platform.
    others = (
        db.query(Question)
        .filter(Question.created_by_id != teacher.id, Question.is_active.is_(True))
        .order_by(Question.id.asc())
        .all()
    )
    for q in others:
        _add(
            title=q.title,
            prompt_markdown=q.prompt_markdown,
            model_answer=q.model_answer,
            subject=q.subject,
            bloom_level=resolve_bloom(q),
            rubric_json=question_rubric(q),
            source_prompt=getattr(q, "source_prompt", None),
        )

    db.commit()
    for row in imported:
        db.refresh(row)
    return [_question_out(row) for row in imported]


@teacher_router.get("/questions", response_model=list[QuestionOut])
def list_questions(
    db: Session = Depends(get_db),
    teacher: User = Depends(require_teacher),
):
    rows = (
        db.query(Question)
        .filter(Question.created_by_id == teacher.id, Question.is_active.is_(True))
        .order_by(Question.id.desc())
        .all()
    )
    return [_question_out(row) for row in rows]


@teacher_router.patch("/questions/{question_id}", response_model=QuestionOut)
def update_question(
    question_id: int,
    payload: QuestionUpdate,
    db: Session = Depends(get_db),
    teacher: User = Depends(require_teacher),
):
    q = (
        db.query(Question)
        .filter(Question.id == question_id, Question.created_by_id == teacher.id)
        .first()
    )
    if not q:
        raise HTTPException(status_code=404, detail="Question not found")
    data = payload.model_dump(exclude_unset=True)
    rubric = data.pop("rubric", None)
    for key, value in data.items():
        setattr(q, key, value)
    if payload.bloom_level is not None:
        q.difficulty = difficulty_from_bloom(payload.bloom_level)
    if rubric is not None:
        q.rubric_json = normalize_rubric(rubric)
    db.commit()
    db.refresh(q)
    return _question_out(q)


@teacher_router.post("/tests", response_model=TestOut)
def create_test(
    payload: TestCreate,
    db: Session = Depends(get_db),
    teacher: User = Depends(require_teacher),
):
    ids = payload.question_ids
    if len(set(ids)) != len(ids):
        raise HTTPException(status_code=400, detail="Question list must not contain duplicates")
    questions: list[Question] = []
    for qid in ids:
        q = db.query(Question).filter(Question.id == qid, Question.created_by_id == teacher.id).first()
        if not q or not q.is_active:
            raise HTTPException(status_code=400, detail=f"Invalid question {qid}")
        questions.append(q)

    test = TheoryTest(
        title=payload.title.strip(),
        duration_minutes=payload.duration_minutes,
        created_by_id=teacher.id,
        invite_code=_invite_code(db),
        is_published_results=False,
        is_active=True,
    )
    db.add(test)
    db.flush()
    for order, q in enumerate(questions, start=1):
        db.add(
            TheoryTestQuestion(
                theory_test_id=test.id,
                question_id=q.id,
                order_index=order,
                required_difficulty=difficulty_from_bloom(resolve_bloom(q)),
            )
        )
    db.commit()
    db.refresh(test)
    return _test_out(test)


@teacher_router.get("/tests", response_model=list[TestOut])
def list_tests(db: Session = Depends(get_db), teacher: User = Depends(require_teacher)):
    rows = (
        db.query(TheoryTest)
        .filter(TheoryTest.created_by_id == teacher.id, TheoryTest.is_active.is_(True))
        .order_by(TheoryTest.id.desc())
        .all()
    )
    return [_test_out(row) for row in rows]


@teacher_router.get("/tests/{test_id}", response_model=TestOut)
def get_test(test_id: int, db: Session = Depends(get_db), teacher: User = Depends(require_teacher)):
    test = (
        db.query(TheoryTest)
        .filter(TheoryTest.id == test_id, TheoryTest.created_by_id == teacher.id)
        .first()
    )
    if not test:
        raise HTTPException(status_code=404, detail="Test not found")
    return _test_out(test)


@teacher_router.post("/tests/{test_id}/assign", response_model=AssignmentOut)
def assign_student(
    test_id: int,
    payload: AssignByEmailRequest,
    db: Session = Depends(get_db),
    teacher: User = Depends(require_teacher),
):
    test = (
        db.query(TheoryTest)
        .filter(TheoryTest.id == test_id, TheoryTest.created_by_id == teacher.id)
        .first()
    )
    if not test:
        raise HTTPException(status_code=404, detail="Test not found")
    student = (
        db.query(User)
        .filter(User.email == payload.student_email.lower().strip(), User.role == UserRole.STUDENT)
        .first()
    )
    if not student:
        raise HTTPException(status_code=404, detail="Student not found — they must register first")
    existing = (
        db.query(TestAssignment)
        .filter(TestAssignment.theory_test_id == test.id, TestAssignment.student_id == student.id)
        .first()
    )
    if existing:
        return AssignmentOut(
            id=existing.id,
            theory_test_id=test.id,
            student_id=student.id,
            status=existing.status,
            test_title=test.title,
            duration_minutes=test.duration_minutes,
            is_published_results=test.is_published_results,
            student_email=student.email,
            student_name=student.full_name,
        )
    row = TestAssignment(
        theory_test_id=test.id,
        student_id=student.id,
        status=AssignmentStatus.ASSIGNED,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return AssignmentOut(
        id=row.id,
        theory_test_id=test.id,
        student_id=student.id,
        status=row.status,
        test_title=test.title,
        duration_minutes=test.duration_minutes,
        is_published_results=test.is_published_results,
        student_email=student.email,
        student_name=student.full_name,
    )


@teacher_router.get("/tests/{test_id}/assignments", response_model=list[AssignmentOut])
def list_assignments(
    test_id: int,
    db: Session = Depends(get_db),
    teacher: User = Depends(require_teacher),
):
    test = (
        db.query(TheoryTest)
        .filter(TheoryTest.id == test_id, TheoryTest.created_by_id == teacher.id)
        .first()
    )
    if not test:
        raise HTTPException(status_code=404, detail="Test not found")
    rows = db.query(TestAssignment).filter(TestAssignment.theory_test_id == test.id).all()
    out: list[AssignmentOut] = []
    for row in rows:
        student = db.query(User).filter(User.id == row.student_id).first()
        out.append(
            AssignmentOut(
                id=row.id,
                theory_test_id=test.id,
                student_id=row.student_id,
                status=row.status,
                test_title=test.title,
                duration_minutes=test.duration_minutes,
                is_published_results=test.is_published_results,
                student_email=student.email if student else None,
                student_name=student.full_name if student else None,
            )
        )
    return out
