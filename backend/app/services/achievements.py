"""Achievement catalog derived from real learning activity."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime


@dataclass(frozen=True)
class AchievementDef:
    id: str
    title: str
    description: str
    check: str  # key into facts dict


ACHIEVEMENT_DEFS: tuple[AchievementDef, ...] = (
    AchievementDef("streak_7", "First Week", "Maintain a 7-day learning streak", "best_streak_7"),
    AchievementDef("streak_14", "Consistent Learner", "Maintain a 14-day learning streak", "best_streak_14"),
    AchievementDef("streak_30", "Dedicated Scholar", "Maintain a 30-day learning streak", "best_streak_30"),
    AchievementDef("streak_50", "50-Day Scholar", "Maintain a 50-day learning streak", "best_streak_50"),
    AchievementDef("streak_100", "Century Learner", "Maintain a 100-day learning streak", "best_streak_100"),
    AchievementDef("consistent_5", "Consistent", "Study 5 days in a row", "best_streak_5"),
    AchievementDef("perfect_score", "Perfect Score", "Score 100% on a quiz or assignment", "perfect_score"),
    AchievementDef("quiz_master", "Quiz Master", "Complete 25 quizzes", "quiz_count_25"),
)

TEACHER_MILESTONE_DEFS: tuple[AchievementDef, ...] = (
    AchievementDef("first_classroom", "First Classroom", "Created your first classroom", "classrooms_1"),
    AchievementDef("resources_50", "50 Resources", "Uploaded 50 learning resources", "documents_50"),
    AchievementDef("assignments_100", "100 Assignments", "Published 100 assignments", "assignments_100"),
    AchievementDef("active_educator", "Active Educator", "Maintained active classroom engagement", "has_recent_activity"),
)


def _is_unlocked(fact_key: str, facts: dict) -> bool:
    return bool(facts.get(fact_key))


def build_achievements(defs: tuple[AchievementDef, ...], facts: dict) -> list[dict]:
    items: list[dict] = []
    for achievement in defs:
        unlocked = _is_unlocked(achievement.check, facts)
        items.append(
            {
                "id": achievement.id,
                "title": achievement.title,
                "description": achievement.description,
                "unlocked": unlocked,
                "unlocked_at": facts.get(f"{achievement.check}_at") if unlocked else None,
            }
        )
    return items


def student_achievement_facts(
    *,
    best_streak: int,
    quiz_count: int,
    has_perfect_score: bool,
) -> dict:
    return {
        "best_streak_5": best_streak >= 5,
        "best_streak_7": best_streak >= 7,
        "best_streak_14": best_streak >= 14,
        "best_streak_30": best_streak >= 30,
        "best_streak_50": best_streak >= 50,
        "best_streak_100": best_streak >= 100,
        "perfect_score": has_perfect_score,
        "quiz_count_25": quiz_count >= 25,
    }


def teacher_milestone_facts(
    *,
    classrooms: int,
    documents: int,
    assignments: int,
    has_recent_activity: bool,
) -> dict:
    return {
        "classrooms_1": classrooms >= 1,
        "documents_50": documents >= 50,
        "assignments_100": assignments >= 100,
        "has_recent_activity": has_recent_activity,
    }
