"""Socratic Code Mentor API.

Endpoints
- GET  /health         quick liveness + config check (no AI call)
- POST /mentor/stream  Server-Sent Events: meta -> partial* -> (reset ->
                       partial*)? -> done | error
- POST /mentor         same result, one JSON response (fallback)

Privacy: user code and problem text are never logged. Only error codes,
model names and timings are.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import time
from collections import defaultdict, deque
from typing import AsyncIterator, Literal, Optional

from dotenv import load_dotenv
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import BaseModel, Field, ValidationError, field_validator

load_dotenv(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".env"))

import llm  # noqa: E402  (needs env loaded first)
from guard import clamp_words, find_spoiler, parse_partial, strip_code  # noqa: E402
from prompts import STATUSES, TEACH_FORMATS, WORD_LIMITS, build_prompt  # noqa: E402

VERSION = "2.0.0"
REQUEST_TIMEOUT_S = float(os.getenv("REQUEST_TIMEOUT_S", "30"))
RATE_LIMIT_PER_MIN = int(os.getenv("RATE_LIMIT_PER_MIN", "20"))
MAX_BODY_BYTES = 64 * 1024

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger("socratic_code_mentor")
# httpx logs full request lines at INFO; keep the console to our own summaries.
logging.getLogger("httpx").setLevel(logging.WARNING)

app = FastAPI(title="Socratic Code Mentor API", version=VERSION)

# Only Chrome extensions may call the API from a browser. Websites you visit
# cannot. Pin it to your own extension with ALLOWED_ORIGINS=chrome-extension://<id>
_origins = [o.strip() for o in os.getenv("ALLOWED_ORIGINS", "").split(",") if o.strip()]
app.add_middleware(
    CORSMiddleware,
    allow_origins=_origins,
    allow_origin_regex=None if _origins else r"chrome-extension://[a-p]{32}",
    allow_credentials=False,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["Content-Type"],
)


# ---------------------------------------------------------------------------
# Models
# ---------------------------------------------------------------------------

class MentorRequest(BaseModel):
    problem: str = Field(min_length=5, max_length=12000)
    code: str = Field(default="", max_length=20000)
    language: str = Field(default="", max_length=40)
    hint_level: int = Field(default=1, ge=1, le=3)
    # Only short labels from earlier answers. Never the full history.
    recent_gaps: list[str] = Field(default_factory=list, max_length=5)
    recent_formats: list[str] = Field(default_factory=list, max_length=5)

    @field_validator("recent_gaps", "recent_formats")
    @classmethod
    def _short_labels(cls, items: list[str]) -> list[str]:
        return [str(i)[:80] for i in items]


class ConceptGap(BaseModel):
    name: str
    one_line_explanation: str
    why_it_matters: str


class Teach(BaseModel):
    format: str
    content: str

    @field_validator("format")
    @classmethod
    def _known_format(cls, value: str) -> str:
        return value if value in TEACH_FORMATS else "worked_example"


class More(BaseModel):
    complexity: Optional[str] = None
    edge_case: Optional[str] = None
    related_concept: Optional[str] = None


class MentorResponse(BaseModel):
    status: Literal[tuple(STATUSES)]  # type: ignore[valid-type]
    concept_gap: ConceptGap
    teach: Teach
    try_next: str
    check_question: str
    more: Optional[More] = None
    model: str = ""
    guarded: bool = False  # true if code had to be scrubbed from the answer


def shape(result: MentorResponse) -> MentorResponse:
    """Enforce word limits server-side."""
    for path, limit in WORD_LIMITS.items():
        head, _, tail = path.partition(".")
        target = getattr(result, head) if tail else result
        attr = tail or head
        if target is not None and isinstance(getattr(target, attr, None), str):
            setattr(target, attr, clamp_words(getattr(target, attr), limit))
    return result


def scrub(result: MentorResponse) -> MentorResponse:
    data = result.model_dump()

    def walk(v):
        if isinstance(v, str):
            return strip_code(v) if find_spoiler(v) else v
        if isinstance(v, dict):
            return {k: walk(x) for k, x in v.items()}
        return v

    cleaned = MentorResponse.model_validate(walk(data))
    cleaned.guarded = True
    return cleaned


# ---------------------------------------------------------------------------
# Rate limiting and body size (simple, in-memory, per client IP)
# ---------------------------------------------------------------------------

_hits: dict[str, deque] = defaultdict(deque)


def rate_limited(request: Request) -> bool:
    ip = request.client.host if request.client else "unknown"
    now = time.monotonic()
    q = _hits[ip]
    while q and now - q[0] > 60:
        q.popleft()
    if len(q) >= RATE_LIMIT_PER_MIN:
        return True
    q.append(now)
    return False


def error_response(err: llm.MentorError) -> JSONResponse:
    return JSONResponse(status_code=err.status, content={"detail": err.message, **err.as_dict()})


async def parse_request(request: Request) -> MentorRequest:
    if int(request.headers.get("content-length") or 0) > MAX_BODY_BYTES:
        raise llm.MentorError("too_large", "Problem and code are too large to send.", 413)
    if rate_limited(request):
        raise llm.MentorError("rate_limited", "Too many requests. Wait a few seconds.", 429, True)
    raw = await request.body()
    if len(raw) > MAX_BODY_BYTES:
        raise llm.MentorError("too_large", "Problem and code are too large to send.", 413)
    try:
        return MentorRequest.model_validate_json(raw)
    except ValidationError as exc:
        first = exc.errors()[0]
        where = ".".join(str(p) for p in first.get("loc", []))
        raise llm.MentorError("bad_request", f"Invalid request field '{where}': {first.get('msg')}", 422) from exc


# ---------------------------------------------------------------------------
# Core generation loop (shared by both endpoints)
# ---------------------------------------------------------------------------

RETRY_NOTE = (
    "IMPORTANT: your previous answer included code or was malformed. "
    "Answer again in plain words only. No code, no code blocks."
)


async def run_mentor(req: MentorRequest) -> AsyncIterator[tuple[str, dict]]:
    """Yield (event, data). Regenerates once on spoiler or bad output."""
    retry_note = ""
    for attempt in range(2):
        prompt = build_prompt(
            problem=req.problem,
            code=req.code,
            language=req.language,
            hint_level=req.hint_level,
            recent_gaps=req.recent_gaps,
            recent_formats=req.recent_formats,
            retry_note=retry_note,
        )
        buf, model_used, last_partial, problem = "", "", None, None
        stream = llm.stream_json(prompt)
        try:
            async with asyncio.timeout(REQUEST_TIMEOUT_S):
                async for model, chunk in stream:
                    if not model_used:
                        model_used = model
                        yield "meta", {"model": model, "attempt": attempt}
                    buf += chunk
                    if problem:
                        continue  # last attempt leaked code: finish quietly, scrub below
                    partial = parse_partial(buf)
                    if partial and partial != last_partial:
                        problem = find_spoiler(partial)
                        if problem and attempt == 0:
                            break  # stop showing it and regenerate
                        if problem:
                            continue
                        last_partial = partial
                        yield "partial", partial
        except llm.MentorError as err:
            # The stream died part-way (e.g. model overloaded mid-answer).
            if attempt == 0 and err.retryable and model_used:
                problem = f"stream_{err.code}"
            else:
                raise
        finally:
            await stream.aclose()

        result: MentorResponse | None = None
        if not problem or (attempt == 1 and not problem.startswith("stream_")):
            try:
                result = shape(MentorResponse.model_validate({**json.loads(buf), "model": model_used}))
                problem = find_spoiler(result.model_dump(exclude={"model", "status"}))
            except (json.JSONDecodeError, ValidationError):
                problem, result = "malformed_output", None

        if not problem and result is not None:
            yield "done", result.model_dump()
            return
        if attempt == 0:
            logger.info("regenerating reason=%s", problem)
            yield "reset", {"reason": problem}
            retry_note = RETRY_NOTE
            continue
        if result is not None:  # second spoiler: scrub rather than fail
            yield "done", scrub(result).model_dump()
            return
        raise llm.MentorError("bad_output", "The AI returned an unusable answer. Retry.", 502, True)


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@app.get("/health")
def health():
    key = (os.getenv("GEMINI_API_KEY") or "").strip()
    return {
        "status": "ok",
        "service": "Socratic Code Mentor",
        "version": VERSION,
        "model": llm.settings()["models"][0],
        "key_configured": key not in llm.PLACEHOLDER_KEYS,
    }


def _log(endpoint: str, started: float, outcome: str, model: str = "") -> None:
    logger.info("%s outcome=%s model=%s ms=%d", endpoint, outcome, model or "-", (time.perf_counter() - started) * 1000)


@app.post("/mentor/stream")
async def mentor_stream(request: Request):
    started = time.perf_counter()
    try:
        req = await parse_request(request)
        llm.get_client()  # fail fast with a real HTTP status if the key is missing
    except llm.MentorError as err:
        _log("/mentor/stream", started, err.code)
        return error_response(err)

    async def events():
        model = ""
        try:
            async for event, data in run_mentor(req):
                if event == "meta":
                    model = data["model"]
                    data = {**data, "ms": int((time.perf_counter() - started) * 1000)}
                yield f"event: {event}\ndata: {json.dumps(data)}\n\n"
            _log("/mentor/stream", started, "ok", model)
        except asyncio.CancelledError:
            _log("/mentor/stream", started, "client_cancelled", model)
            raise
        except Exception as exc:  # noqa: BLE001
            err = llm.classify(exc)
            _log("/mentor/stream", started, f"{err.code}:{type(exc).__name__}", model)
            yield f"event: error\ndata: {json.dumps(err.as_dict())}\n\n"

    return StreamingResponse(
        events(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@app.post("/mentor")
async def mentor(request: Request):
    started = time.perf_counter()
    try:
        req = await parse_request(request)
        async for event, data in run_mentor(req):
            if event == "done":
                _log("/mentor", started, "ok", data.get("model", ""))
                return data
        raise llm.MentorError("bad_output", "The AI returned no answer. Retry.", 502, True)
    except Exception as exc:  # noqa: BLE001
        err = llm.classify(exc)
        _log("/mentor", started, f"{err.code}:{type(exc).__name__}")
        return error_response(err)
