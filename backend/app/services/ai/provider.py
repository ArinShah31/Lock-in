from abc import ABC, abstractmethod

from app.schemas.course_builder import ArtifactType, ChapterNotesContent, CourseBuilderOutput


class CourseBuilderProvider(ABC):
    @abstractmethod
    def generate_course(
        self,
        *,
        subject_name: str,
        syllabus_text: str | None,
        syllabus_file_path: str | None,
        requested_artifacts: list[ArtifactType],
    ) -> CourseBuilderOutput:
        """Generate structured course content for a subject syllabus."""

    @abstractmethod
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
        """Generate classroom-complete lesson notes for one chapter."""
