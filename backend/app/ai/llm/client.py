from google import genai
from google.genai import types

from app.ai.llm.models import ChatResponse, LlmChatPayload
from app.core.config import settings

_SAFETY_SETTINGS = [
    types.SafetySetting(
        category=types.HarmCategory.HARM_CATEGORY_HARASSMENT,
        threshold=types.HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE,
    ),
    types.SafetySetting(
        category=types.HarmCategory.HARM_CATEGORY_HATE_SPEECH,
        threshold=types.HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE,
    ),
    types.SafetySetting(
        category=types.HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT,
        threshold=types.HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE,
    ),
    types.SafetySetting(
        category=types.HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT,
        threshold=types.HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE,
    ),
]


def gemini_api_keys() -> list[str]:
    return settings.gemini_keys_for_notes_pool()


def _is_retryable_gemini_error(exc: Exception) -> bool:
    message = str(exc).upper()
    return any(
        token in message
        for token in (
            "API_KEY_INVALID",
            "API KEY NOT VALID",
            "INVALID_ARGUMENT",
            "RESOURCE_EXHAUSTED",
            "429",
            "QUOTA",
            "503",
            "UNAVAILABLE",
            "DEADLINE",
            "HIGH DEMAND",
        )
    )


def get_client(api_key: str | None = None) -> genai.Client:
    if api_key:
        return genai.Client(api_key=api_key)
    keys = gemini_api_keys()
    return genai.Client(api_key=keys[0] if keys else "DUMMY_KEY")


def generate_content_with_pool(*, model: str, contents, config):
    keys = gemini_api_keys() or ["DUMMY_KEY"]
    last_exc: Exception | None = None
    for key in keys:
        try:
            client = genai.Client(api_key=key)
            return client.models.generate_content(
                model=model,
                contents=contents,
                config=config,
            )
        except Exception as exc:
            last_exc = exc
            if _is_retryable_gemini_error(exc):
                continue
            raise
    if last_exc is not None:
        raise last_exc
    raise RuntimeError("No Gemini API keys configured")


def _safety_blocked_response() -> ChatResponse:
    return ChatResponse(
        document_answer="",
        additional_explanation="",
        used_document=False,
        used_general_knowledge=False,
        blocked=True,
    )


def _is_safety_blocked(response) -> bool:
    prompt_feedback = getattr(response, "prompt_feedback", None)
    block_reason = getattr(prompt_feedback, "block_reason", None) if prompt_feedback else None
    if block_reason:
        return True

    for candidate in getattr(response, "candidates", None) or []:
        finish = str(getattr(candidate, "finish_reason", "") or "").upper()
        if "SAFETY" in finish:
            return True
    return False


def _chat_models_to_try() -> list[str]:
    primary = settings.gemini_chat_model.strip() or "gemini-3.6-flash"
    fallbacks = (
        settings.gemini_model.strip() or "gemini-3.6-flash",
        "gemini-3.6-flash",
        "gemini-flash-latest",
        "gemini-2.5-flash",
    )
    models = [primary]
    for model in fallbacks:
        if model and model not in models:
            models.append(model)
    return models


def generate_answer(prompt: str) -> ChatResponse | None:
    last_exc: Exception | None = None
    response = None
    models_to_try = _chat_models_to_try()
    for index, model in enumerate(models_to_try):
        try:
            response = generate_content_with_pool(
                model=model,
                contents=prompt,
                config=types.GenerateContentConfig(
                    response_mime_type="application/json",
                    response_schema=LlmChatPayload,
                    safety_settings=_SAFETY_SETTINGS,
                ),
            )
            break
        except Exception as exc:
            last_exc = exc
            message = str(exc).upper()
            if "SAFETY" in message or "BLOCKED" in message or "PROHIBITED" in message:
                return _safety_blocked_response()
            if "NOT_FOUND" in message and index < len(models_to_try) - 1:
                continue
            raise
    if response is None:
        if last_exc is not None:
            raise last_exc
        return None

    if _is_safety_blocked(response):
        return _safety_blocked_response()

    parsed = response.parsed
    if parsed is not None:
        payload = parsed if isinstance(parsed, LlmChatPayload) else LlmChatPayload.model_validate(parsed)
        return ChatResponse(**payload.model_dump(), blocked=False)

    # Fallback if the SDK returns raw JSON text without parsed schema.
    raw = (getattr(response, "text", None) or "").strip()
    if not raw:
        return None
    try:
        payload = LlmChatPayload.model_validate_json(raw)
        return ChatResponse(**payload.model_dump(), blocked=False)
    except Exception:
        return None
