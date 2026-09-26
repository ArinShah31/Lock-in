"""Shared starter question catalog for seeding and teacher import."""

from app.models import BloomLevel, SubjectArea
from app.services.bloom import DEFAULT_RUBRIC

STARTER_QUESTIONS: list[tuple[str, SubjectArea, BloomLevel, str, str, list[dict]]] = [
    (
        "Photosynthesis Overview",
        SubjectArea.SCIENCE,
        BloomLevel.UNDERSTAND,
        "Explain how plants convert light energy into chemical energy during photosynthesis. "
        "Include the role of chlorophyll and the basic inputs/outputs.",
        "Chlorophyll absorbs light; CO2 + water → glucose + O2 in chloroplasts; light and dark reactions.",
        DEFAULT_RUBRIC,
    ),
    (
        "Newton's Second Law",
        SubjectArea.SCIENCE,
        BloomLevel.APPLY,
        "A 4 kg object accelerates at 3 m/s². Calculate the net force and explain your reasoning.",
        "F = ma = 12 N; state formula, substitute values, include units.",
        DEFAULT_RUBRIC,
    ),
    (
        "Quadratic Roots",
        SubjectArea.MATHEMATICS,
        BloomLevel.APPLY,
        "Solve x² - 5x + 6 = 0 and verify both roots satisfy the equation.",
        "Factor to (x-2)(x-3)=0; roots x=2,3; substitute back to verify.",
        DEFAULT_RUBRIC,
    ),
    (
        "Supply and Demand",
        SubjectArea.BUSINESS,
        BloomLevel.ANALYZE,
        "Describe what happens to equilibrium price and quantity when demand increases but supply stays constant.",
        "Higher demand shifts curve right; equilibrium price and quantity both rise; explain mechanism.",
        DEFAULT_RUBRIC,
    ),
    (
        "Industrial Revolution Causes",
        SubjectArea.HUMANITIES,
        BloomLevel.EVALUATE,
        "Evaluate two major causes of the Industrial Revolution in Britain. Which was more significant? Justify.",
        "Agricultural productivity + capital/technology; weigh evidence for each; clear conclusion.",
        DEFAULT_RUBRIC,
    ),
    (
        "Algorithm Complexity",
        SubjectArea.COMPUTER_SCIENCE,
        BloomLevel.ANALYZE,
        "Compare linear search and binary search on a sorted array. When is each appropriate?",
        "Linear O(n) unsorted/small; binary O(log n) sorted; trade-offs on preprocessing and memory.",
        DEFAULT_RUBRIC,
    ),
    (
        "Ethics Case Study",
        SubjectArea.GENERAL,
        BloomLevel.CREATE,
        "A team discovers their product harms a small user group. Propose an ethical response plan in 3 steps.",
        "Acknowledge harm, mitigate/stop rollout, communicate + remediate; justify with duty-of-care.",
        DEFAULT_RUBRIC,
    ),
]
