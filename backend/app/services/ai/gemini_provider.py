import json
from pathlib import Path

from app.schemas.course_builder import ArtifactType, ChapterNotesContent, CourseBuilderOutput
from app.services.ai.provider import CourseBuilderProvider


class GeminiCourseBuilderProvider(CourseBuilderProvider):
    def __init__(self, api_key: str, model: str):
        self.api_key = api_key
        self.model = model

    def generate_course(
        self,
        *,
        subject_name: str,
        syllabus_text: str | None,
        syllabus_file_path: str | None,
        requested_artifacts: list[ArtifactType],
    ) -> CourseBuilderOutput:
        from google import genai

        client = genai.Client(api_key=self.api_key)
        prompt = self._build_prompt(subject_name, syllabus_text)
        contents = self._build_contents(client, prompt, syllabus_text, syllabus_file_path)
        response = client.models.generate_content(
            model=self.model,
            contents=contents,
            config={
                "response_mime_type": "application/json",
                "response_schema": CourseBuilderOutput,
            },
        )
        if getattr(response, "parsed", None):
            return response.parsed
        return CourseBuilderOutput.model_validate(json.loads(response.text))

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
        from google import genai

        client = genai.Client(api_key=self.api_key)
        prompt = self._build_notes_prompt(
            subject_name=subject_name,
            chapter=chapter,
            chapter_title=chapter_title,
            topics=topics,
            objectives=objectives,
            summary=summary,
            syllabus_text=syllabus_text,
        )
        contents = self._build_contents(client, prompt, syllabus_text, syllabus_file_path)
        response = client.models.generate_content(
            model=self.model,
            contents=contents,
            config={
                "response_mime_type": "application/json",
                "response_schema": ChapterNotesContent,
            },
        )
        if getattr(response, "parsed", None):
            return response.parsed
        return ChapterNotesContent.model_validate(json.loads(response.text))

    def _build_contents(
        self,
        client,
        prompt: str,
        syllabus_text: str | None,
        syllabus_file_path: str | None,
    ) -> list[object]:
        contents: list[object] = [prompt]
        if syllabus_file_path:
            path = Path(syllabus_file_path)
            if not path.is_absolute():
                path = Path.cwd() / path
            if not path.exists():
                raise FileNotFoundError(f"Syllabus file not found at {path}")
            contents.append(client.files.upload(file=str(path)))
        elif not (syllabus_text or "").strip():
            raise ValueError("No syllabus text or file was provided for Gemini generation")
        return contents

    @staticmethod
    def _build_prompt(subject_name: str, syllabus_text: str | None) -> str:
        return f"""
You are ASTRA's AI course builder for college teachers.

Subject: {subject_name}

Read the attached syllabus carefully (or the syllabus text below) and generate 3 to 6 ordered learning chapters
that follow THAT syllabus — do not invent a generic programming course if the syllabus is more specific.

Each chapter must include:
- chapter number, title, summary, timeline
- objectives, topics, activities grounded in the syllabus
- 2-4 flashcards (question/answer) from that chapter's content
- 1-3 MCQ quiz questions with options, correct_answer, explanation
- one short assessment with title, instructions, 2 prompts, rubric, estimated_minutes

Keep content concise and practical.
Return only JSON matching the schema with a top-level "chapters" array.

Syllabus text:
{syllabus_text or "Primary source is the attached syllabus file. Extract chapters from that document."}
"""

    @staticmethod
    def _build_notes_prompt(
        *,
        subject_name: str,
        chapter: int,
        chapter_title: str,
        topics: list[str],
        objectives: list[str],
        summary: str | None,
        syllabus_text: str | None,
    ) -> str:
        topic_list = "\n".join(f"- {topic}" for topic in topics) or "- (derive lessons from chapter title and syllabus)"
        objective_list = "\n".join(f"- {item}" for item in objectives) or "- (derive from syllabus)"
        return f"""
You are ASTRA's AI teaching-notes writer for college students.

Subject: {subject_name}
Chapter {chapter}: {chapter_title}
Chapter summary: {summary or "N/A"}

Create complete self-study lesson notes for THIS chapter only.
Use one lesson per topic below (or invent 3-5 coherent lessons if topics are empty), aligned to the syllabus.

Topics / lessons to cover:
{topic_list}

Chapter objectives:
{objective_list}

For each lesson include:
- lesson number, title, short summary
- learning_outcomes
- notes_markdown: thorough classroom-quality notes (definitions, explanations, steps, common mistakes, mini examples) so a student can learn without the teacher present
- key_terms, examples, practice_prompts

Write notes_markdown in Markdown with clear headings. Be practical and syllabus-faithful.
Return JSON matching the schema with chapter, chapter_title, intro, and lessons.

Syllabus text:
{syllabus_text or "Primary source is the attached syllabus file. Ground every lesson in that document."}
"""
