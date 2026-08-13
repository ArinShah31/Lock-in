from pydantic import BaseModel, Field


class LlmChatPayload(BaseModel):
    document_answer: str
    additional_explanation: str
    used_document: bool
    used_general_knowledge: bool


class ChatResponse(LlmChatPayload):
    blocked: bool = Field(default=False)