from pydantic import BaseModel


class ChatResponse(BaseModel):
    document_answer: str
    additional_explanation: str
    used_document: bool
    used_general_knowledge: bool