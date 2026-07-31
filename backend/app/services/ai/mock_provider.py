from app.schemas.course_builder import (
    ArtifactType,
    Assessment,
    AssessmentPrompt,
    ChapterContent,
    ChapterNotesContent,
    CourseBuilderOutput,
    Flashcard,
    LessonNote,
    QuizQuestion,
)
from app.services.ai.provider import CourseBuilderProvider


class MockCourseBuilderProvider(CourseBuilderProvider):
    def generate_course(
        self,
        *,
        subject_name: str,
        syllabus_text: str | None,
        syllabus_file_path: str | None,
        requested_artifacts: list[ArtifactType],
    ) -> CourseBuilderOutput:
        source_hint = (syllabus_text or "").strip()
        if not source_hint and syllabus_file_path:
            source_hint = f"Uploaded syllabus file: {syllabus_file_path}"
        if not source_hint:
            source_hint = "No syllabus text was provided."

        chapters = [
            ChapterContent(
                chapter=1,
                title=f"Foundations of {subject_name}",
                summary="Build baseline vocabulary and understand course goals.",
                timeline="1-2 weeks",
                objectives=["Understand course goals", "Identify prerequisite concepts"],
                topics=["Course overview", "Core vocabulary", "Baseline practice"],
                activities=["Read the syllabus", "Complete a diagnostic activity"],
                flashcards=[
                    Flashcard(
                        question=f"What is the main goal of {subject_name}?",
                        answer="To master the outcomes described in the uploaded syllabus.",
                        topic="Course overview",
                        difficulty="EASY",
                    ),
                    Flashcard(
                        question="What should you review before class?",
                        answer="The chapter roadmap, flashcards, and any practice questions.",
                        topic="Study habits",
                        difficulty="EASY",
                    ),
                ],
                quiz=[
                    QuizQuestion(
                        question="What should a learning roadmap help students understand?",
                        options=[
                            "Only exam dates",
                            "The sequence of topics, outcomes, and learning activities",
                            "Only teacher details",
                            "Only grading rules",
                        ],
                        correct_answer="The sequence of topics, outcomes, and learning activities",
                        explanation="A roadmap connects chapter topics with outcomes and activities.",
                        difficulty="EASY",
                    )
                ],
                assessment=Assessment(
                    title=f"{subject_name} Chapter 1 Check",
                    instructions="Answer briefly using syllabus language.",
                    prompts=[
                        AssessmentPrompt(prompt="List two learning outcomes for this chapter."),
                        AssessmentPrompt(prompt="Explain one prerequisite you need for later chapters."),
                    ],
                    rubric=["Accuracy", "Clarity", "Use of syllabus terminology"],
                    estimated_minutes=20,
                ),
            ),
            ChapterContent(
                chapter=2,
                title="Core Concepts and Guided Practice",
                summary="Apply the first major concepts with teacher-guided examples.",
                timeline="2-3 weeks",
                objectives=["Build conceptual understanding", "Apply ideas through examples"],
                topics=["Key syllabus units", "Worked examples", "Practice problems"],
                activities=["Teacher-led walkthrough", "Small-group practice"],
                flashcards=[
                    Flashcard(
                        question="What is guided practice?",
                        answer="Students solve problems with teacher support before independent work.",
                        topic="Pedagogy",
                        difficulty="MEDIUM",
                    )
                ],
                quiz=[
                    QuizQuestion(
                        question="Why do worked examples help beginners?",
                        options=[
                            "They replace all practice",
                            "They show the reasoning steps before independent attempts",
                            "They hide the correct method",
                            "They only help advanced students",
                        ],
                        correct_answer="They show the reasoning steps before independent attempts",
                        explanation="Worked examples model how to approach problems.",
                        difficulty="MEDIUM",
                    )
                ],
                assessment=Assessment(
                    title=f"{subject_name} Chapter 2 Check",
                    instructions=f"Use this chapter context: {source_hint[:180]}",
                    prompts=[
                        AssessmentPrompt(prompt="Solve one example in your own words."),
                        AssessmentPrompt(prompt="Name one mistake beginners often make."),
                    ],
                    rubric=["Accuracy", "Reasoning", "Clarity"],
                    estimated_minutes=25,
                ),
            ),
            ChapterContent(
                chapter=3,
                title="Independent Application",
                summary="Students apply concepts with less scaffolding and prepare for assessment.",
                timeline="2 weeks",
                objectives=["Solve problems independently", "Reflect on learning gaps"],
                topics=["Independent practice", "Common errors", "Revision"],
                activities=["Practice set", "Peer review", "Mini reflection"],
                flashcards=[
                    Flashcard(
                        question="When is a chapter ready to unlock next?",
                        answer="After the teacher unlocks it, usually once students are ready for the next stage.",
                        topic="Progress",
                        difficulty="EASY",
                    )
                ],
                quiz=[
                    QuizQuestion(
                        question="What is the best next step after guided practice?",
                        options=[
                            "Skip practice",
                            "Independent practice with feedback",
                            "Only watch videos forever",
                            "Ignore mistakes",
                        ],
                        correct_answer="Independent practice with feedback",
                        explanation="Independent practice builds mastery after scaffolding.",
                        difficulty="EASY",
                    )
                ],
                assessment=Assessment(
                    title=f"{subject_name} Chapter 3 Check",
                    instructions="Write short answers demonstrating independent understanding.",
                    prompts=[
                        AssessmentPrompt(prompt="Describe how you would solve a new problem from this chapter."),
                        AssessmentPrompt(prompt="What feedback would help you improve?"),
                    ],
                    rubric=["Independence", "Accuracy", "Reflection"],
                    estimated_minutes=30,
                ),
            ),
        ]

        if ArtifactType.LEARNING_PATH in requested_artifacts or not requested_artifacts:
            return CourseBuilderOutput(chapters=chapters)

        return CourseBuilderOutput(chapters=chapters)

    def generate_chapter_notes(
        self,
        *,
        subject_name: str,
        chapter: int,
        chapter_title: str,
        topics: list[str],
        objectives: list[str],
        summary: str | None,
        syllabus_text: str | None,
        syllabus_file_path: str | None,
    ) -> ChapterNotesContent:
        lesson_titles = topics or [f"Topic {i}" for i in range(1, 4)]
        lessons: list[LessonNote] = []
        for index, title in enumerate(lesson_titles, start=1):
            lessons.append(
                LessonNote(
                    lesson=index,
                    title=title,
                    summary=f"Core ideas for {title} in {chapter_title}.",
                    learning_outcomes=objectives[:2]
                    or [f"Explain {title}", f"Apply {title} in a simple example"],
                    notes_markdown=(
                        f"## {title}\n\n"
                        f"This lesson covers **{title}** within {chapter_title} for {subject_name}.\n\n"
                        f"### What you need to know\n"
                        f"- Definition and purpose of {title}\n"
                        f"- How it connects to: {summary or chapter_title}\n"
                        f"- Common beginner mistakes and how to avoid them\n\n"
                        f"### Step-by-step\n"
                        f"1. Read the definition carefully.\n"
                        f"2. Study one worked example.\n"
                        f"3. Try a short practice prompt on your own.\n\n"
                        f"### Why it matters\n"
                        f"Mastering {title} unlocks later topics in this chapter.\n"
                    ),
                    key_terms=[title, "definition", "example"],
                    examples=[f"Example: a simple classroom scenario using {title}."],
                    practice_prompts=[
                        f"Explain {title} in your own words.",
                        f"Write one short example that uses {title}.",
                    ],
                )
            )
        return ChapterNotesContent(
            chapter=chapter,
            chapter_title=chapter_title,
            intro=(
                f"Study notes for Chapter {chapter}: {chapter_title}. "
                "Work through each lesson in order; these notes are meant to stand alone for self-study."
            ),
            lessons=lessons,
        )
