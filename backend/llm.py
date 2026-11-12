"""Thin wrapper around the Gemini SDK.

One client is created lazily and reused. Streams JSON text chunks,
falls back to the next model on overload (only before any text has been
sent), and turns SDK exceptions into friendly, typed errors.
"""

from __future__ import annotations

import asyncio
import logging
import os
from typing import AsyncIterator

from google import genai
from google.genai import errors as genai_errors
from google.genai import types

from prompts import RESPONSE_SCHEMA, SYSTEM_INSTRUCTION

PLACEHOLDER_KEYS = {"", "replace_with_your_key"}
logger = logging.getLogger("socratic_code_mentor")


class MentorError(Exception):
    """An error with a stable code the extension can react to."""

    def __init__(self, code: str, message: str, status: int = 502, retryable: bool = False):
        super().__init__(message)
        self.code = code
        self.message = message
        self.status = status
        self.retryable = retryable

    def as_dict(self) -> dict:
        return {"code": self.code, "message": self.message, "retryable": self.retryable}


def settings() -> dict:
    primary = os.getenv("GEMINI_MODEL", "gemini-3.5-flash").strip()
    fallbacks = [
        m.strip()
        for m in os.getenv("GEMINI_FALLBACK_MODELS", "gemini-3.5-flash-lite,gemini-3.8-flash").split(",")
        if m.strip() and m.strip() != primary
    ]
    return {
        "models": [primary, *fallbacks],
        "thinking_level": os.getenv("GEMINI_THINKING_LEVEL", "minimal").strip().lower(),
        "temperature": float(os.getenv("GEMINI_TEMPERATURE", "0.6")),
        "max_output_tokens": int(os.getenv("GEMINI_MAX_OUTPUT_TOKENS", "700")),
        "hedge_after": float(os.getenv("HEDGE_AFTER_S", "4")),
    }


_client: genai.Client | None = None
_client_key: str | None = None
# Some models reject certain thinking levels (e.g. MINIMAL). Remember what works.
_thinking_override: dict[str, str | None] = {}
# model -> loop time until which it is skipped after a 429 quota error.
_cooldown: dict[str, float] = {}
QUOTA_COOLDOWN_S = 60.0
QUOTA_MESSAGE = (
    "Your Gemini API key is over its quota (free tier limits). "
    "Wait a minute and retry. If it keeps happening, the daily limit is used up: "
    "try again tomorrow or enable billing in Google AI Studio."
)


def get_client() -> genai.Client:
    global _client, _client_key
    key = (os.getenv("GEMINI_API_KEY") or "").strip()
    if key in PLACEHOLDER_KEYS:
        raise MentorError(
            "missing_key",
            "GEMINI_API_KEY is not set. Add it to backend/.env and restart the backend.",
            status=503,
        )
    if _client is None or key != _client_key:
        _client = genai.Client(api_key=key)
        _client_key = key
    return _client


def _config(model: str, cfg: dict) -> types.GenerateContentConfig:
    level = _thinking_override.get(model, cfg["thinking_level"])
    thinking = types.ThinkingConfig(thinking_level=level) if level else None
    return types.GenerateContentConfig(
        system_instruction=SYSTEM_INSTRUCTION,
        response_mime_type="application/json",
        response_schema=RESPONSE_SCHEMA,
        temperature=cfg["temperature"],
        max_output_tokens=cfg["max_output_tokens"],
        thinking_config=thinking,
        automatic_function_calling=types.AutomaticFunctionCallingConfig(disable=True),
    )


def classify(exc: Exception) -> MentorError:
    if isinstance(exc, MentorError):
        return exc
    if isinstance(exc, genai_errors.APIError):
        code = getattr(exc, "code", 0) or 0
        msg = str(getattr(exc, "message", "") or exc).lower()
        if code == 429 or "quota" in msg or "resource_exhausted" in msg:
            return MentorError("quota", QUOTA_MESSAGE, 429, True)
        if code in (401, 403) or "api key" in msg or "api_key" in msg:
            return MentorError("bad_key", "Gemini rejected the API key. Check GEMINI_API_KEY in backend/.env.", 502)
        if code == 404 or ("model" in msg and code == 400):
            return MentorError("bad_model", "The configured GEMINI_MODEL is not available. Check backend/.env.", 502)
        if code in (500, 502, 503, 504):
            return MentorError("overloaded", "Gemini is busy right now. Retry in a few seconds.", 503, True)
    if isinstance(exc, TimeoutError):
        return MentorError("timeout", "The AI took too long to answer. Retry.", 504, True)
    return MentorError("upstream_error", "The AI request failed unexpectedly. Retry.", 502, True)


def _is_thinking_rejection(exc: Exception) -> bool:
    return isinstance(exc, genai_errors.ClientError) and "thinking" in str(exc).lower()


def _should_fall_back(exc: Exception) -> bool:
    err = classify(exc)
    return err.code in {"overloaded", "bad_model", "quota", "timeout", "bad_output"}


async def _open(client, model: str, prompt: str, cfg: dict):
    """Start a stream on one model and wait for its first text.

    Retries itself when a model rejects the thinking level (minimal -> low -> off).
    Returns (model, first_text, iterator, stream).
    """
    while True:
        try:
            stream = await client.aio.models.generate_content_stream(
                model=model, contents=prompt, config=_config(model, cfg)
            )
            iterator = aiter(stream)
            first = ""
            while not first:
                try:
                    first = (await anext(iterator)).text or ""
                except StopAsyncIteration as exc:
                    raise MentorError("bad_output", "The AI returned an empty answer. Retry.", 502, True) from exc
            return model, first, iterator, stream
        except Exception as exc:  # noqa: BLE001
            if _is_thinking_rejection(exc):
                current = _thinking_override.get(model, cfg["thinking_level"])
                if current:
                    _thinking_override[model] = {"minimal": "low"}.get(current)
                    continue
            raise


async def stream_json(prompt: str) -> AsyncIterator[tuple[str, str]]:
    """Yield (model, text_chunk).

    Hedged start: the primary model gets HEDGE_AFTER_S to produce its first
    text. If it hasn't, the next model is started *in parallel* (the primary
    keeps going) and whichever answers first wins. A model that fails outright
    is replaced by the next one immediately. Gemini latency is spiky, so this
    beats waiting for one model to time out before trying another. The
    overall deadline is enforced by the caller (REQUEST_TIMEOUT_S).
    """
    client = get_client()
    cfg = settings()
    loop = asyncio.get_running_loop()
    # Skip models that just told us we're over quota: calling them again only
    # burns more of it and ends in a misleading timeout.
    queue = [m for m in cfg["models"] if _cooldown.get(m, 0) <= loop.time()]
    if not queue:
        raise MentorError("quota", QUOTA_MESSAGE, 429, True)
    running: dict[asyncio.Task, str] = {}
    last_exc: Exception | None = None
    quota_hit = False
    started = loop.time()

    def launch() -> None:
        if queue:
            model = queue.pop(0)
            running[asyncio.create_task(_open(client, model, prompt, cfg))] = model

    launch()
    winner = None
    try:
        while running and winner is None:
            done, _ = await asyncio.wait(running, timeout=cfg["hedge_after"], return_when=asyncio.FIRST_COMPLETED)
            if not done:
                if queue:
                    logger.info("model=%s slow after %.1fs, hedging", "+".join(running.values()), asyncio.get_running_loop().time() - started)
                    launch()
                continue
            for task in done:
                model = running.pop(task)
                exc = task.exception()
                if exc is None and winner is None:
                    winner = task.result()
                elif exc is None:  # a second model finished in the same tick: drop it
                    stream = task.result()[3]
                    if hasattr(stream, "aclose"):
                        await stream.aclose()
                elif exc is not None:
                    logger.info("model=%s failed=%s http=%s -> %s", model, type(exc).__name__, getattr(exc, "code", "-"), classify(exc).code)
                    last_exc = exc
                    if classify(exc).code == "quota":
                        quota_hit = True
                        _cooldown[model] = loop.time() + QUOTA_COOLDOWN_S
                    if not _should_fall_back(exc):
                        queue.clear()
            if winner is None and not running:
                launch()
            # Everything left is just slow and some model is over quota: say so
            # now instead of waiting for the request timeout.
            if winner is None and quota_hit and not queue and not running:
                break
    finally:
        # Losers (or everything, if we're being cancelled) are stopped.
        for task in running:
            task.cancel()
        for task in running:
            try:
                result = await task
                await result[3].aclose() if hasattr(result[3], "aclose") else None
            except BaseException:  # noqa: BLE001
                pass

    if winner is None:
        if quota_hit:
            raise MentorError("quota", QUOTA_MESSAGE, 429, True)
        raise classify(last_exc or RuntimeError("no models configured"))

    model, first, iterator, _stream = winner
    yield model, first
    try:
        async for chunk in iterator:
            text = chunk.text or ""
            if text:
                yield model, text
    except Exception as exc:  # noqa: BLE001
        logger.info("model=%s failed=%s mid-stream", model, type(exc).__name__)
        raise classify(exc) from exc
