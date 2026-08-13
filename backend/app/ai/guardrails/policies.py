"""Shared refusal messages for ASTRA AI assistants."""

STUDENT_REFUSAL = (
    "ASTRA AI is only for schoolwork. I can't help with that. "
    "Please ask a question about your classroom documents or syllabus."
)

STUDENT_INSUFFICIENT_CONTEXT = (
    "I couldn't find enough information about that topic in this classroom's course materials."
)

TEACHER_REFUSAL = (
    "I can help with your classrooms, course materials, assignments, student activity, "
    "and teaching-related tasks. I can't help with unrelated requests."
)

TEACHER_INSUFFICIENT_CONTEXT = (
    "I couldn't find enough information in the available classroom materials to answer that."
)

UNAUTHORIZED_CLASSROOM = "You don't have access to this classroom."

UNAUTHORIZED_TEACHER_FEATURE = "You don't have permission to use the Teacher AI assistant."

INJECTION_REFUSAL = (
    "I can't provide internal instructions, credentials, or system information."
)
