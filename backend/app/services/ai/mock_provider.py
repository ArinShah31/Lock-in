from app.schemas.course_builder import (
    ArtifactType,
    ChapterContent,
    ChapterNotesContent,
    CourseBuilderOutput,
    Flashcard,
    LessonNote,
    QuizQuestion,
)
from app.services.ai.provider import CourseBuilderProvider, ProgressCallback


def _flashcards(subject_name: str, chapter_title: str, topics: list[str]) -> list[Flashcard]:
    cards: list[Flashcard] = []
    seeds = topics[:] or [f"Idea {i}" for i in range(1, 6)]
    while len(seeds) < 10:
        seeds.append(seeds[len(seeds) % max(len(topics), 1)] if topics else f"Topic {len(seeds) + 1}")
    for index in range(10):
        topic = seeds[index]
        cards.append(
            Flashcard(
                question=f"[{chapter_title}] What should you remember about {topic}?",
                answer=f"In {subject_name}, {topic} is a core idea of {chapter_title}: know the definition, one example, and one common mistake.",
                topic=topic,
                difficulty="EASY" if index < 4 else "MEDIUM" if index < 8 else "HARD",
            )
        )
    return cards


def _quiz(chapter_title: str, topics: list[str]) -> list[QuizQuestion]:
    questions: list[QuizQuestion] = []
    seeds = topics[:] or [f"Concept {i}" for i in range(1, 6)]
    while len(seeds) < 15:
        seeds.append(seeds[len(seeds) % max(len(topics), 1)] if topics else f"Concept {len(seeds) + 1}")
    for index in range(15):
        topic = seeds[index]
        correct = f"A clear, syllabus-aligned understanding of {topic}"
        questions.append(
            QuizQuestion(
                question=f"Which statement best summarizes {topic} in {chapter_title}?",
                options=[
                    correct,
                    f"Ignore {topic} until the final exam",
                    f"{topic} is unrelated to {chapter_title}",
                    f"Only memorize the name of {topic}",
                ],
                correct_answer=correct,
                explanation=f"Students should understand what {topic} means and how it fits this chapter.",
                difficulty="EASY" if index < 5 else "MEDIUM" if index < 11 else "HARD",
            )
        )
    return questions


class MockCourseBuilderProvider(CourseBuilderProvider):
    def generate_course(
        self,
        *,
        subject_name: str,
        syllabus_text: str | None,
        syllabus_file_path: str | None,
        requested_artifacts: list[ArtifactType],
        on_progress: ProgressCallback | None = None,
    ) -> CourseBuilderOutput:
        if on_progress:
            on_progress("Mock provider: building chapters…")
        chapters_meta = [
            (
                1,
                f"Foundations of {subject_name}",
                "Build baseline vocabulary and understand course goals.",
                "1-2 weeks",
                ["Understand course goals", "Identify prerequisite concepts"],
                ["Course overview", "Core vocabulary", "Baseline practice", "Study habits", "Syllabus map"],
                ["Read the syllabus", "Complete a diagnostic activity"],
            ),
            (
                2,
                "Core Concepts and Guided Practice",
                "Apply the first major concepts with teacher-guided examples.",
                "2-3 weeks",
                ["Build conceptual understanding", "Apply ideas through examples"],
                ["Key syllabus units", "Worked examples", "Practice problems", "Guided practice", "Feedback loops"],
                ["Teacher-led walkthrough", "Small-group practice"],
            ),
            (
                3,
                "Independent Application",
                "Students apply concepts with less scaffolding and prepare for checks.",
                "2 weeks",
                ["Solve problems independently", "Reflect on learning gaps"],
                ["Independent practice", "Common errors", "Revision", "Self-checks", "Transfer tasks"],
                ["Practice set", "Peer review", "Mini reflection"],
            ),
        ]

        chapters = [
            ChapterContent(
                chapter=number,
                title=title,
                summary=summary,
                timeline=timeline,
                objectives=objectives,
                topics=topics,
                activities=activities,
                flashcards=_flashcards(subject_name, title, topics),
                quiz=_quiz(title, topics),
                assessment=None,
            )
            for number, title, summary, timeline, objectives, topics, activities in chapters_meta
        ]
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
        on_progress: ProgressCallback | None = None,
    ) -> ChapterNotesContent:
        if on_progress:
            on_progress(f"Mock provider: writing notes for chapter {chapter}…")
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
