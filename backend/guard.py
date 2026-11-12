"""Output safety and shaping helpers.

- parse_partial: best-effort parse of an incomplete JSON stream so the
  panel can render fields as they arrive.
- find_spoiler: server-side check that the model did not leak solution
  code (the prompt rule alone is not enough).
- clamp_words / sanitize: final shaping before the result is returned.
"""

from __future__ import annotations

import json
import re
from typing import Any

# ---------------------------------------------------------------------------
# Partial JSON
# ---------------------------------------------------------------------------

_TRAILING_JUNK = [
    re.compile(r',\s*$'),                        # dangling comma
    re.compile(r',?\s*"(?:[^"\\]|\\.)*"\s*:\s*$'),  # key with no value yet
    re.compile(r',?\s*"(?:[^"\\]|\\.)*$'),        # half-written key
    re.compile(r':\s*[a-z]+$'),                  # partial true/false/null
]


def parse_partial(text: str) -> dict | None:
    """Return the most complete object parseable from a JSON prefix."""
    text = text.strip()
    if not text.startswith("{"):
        return None
    try:
        value = json.loads(text)
        return value if isinstance(value, dict) else None
    except json.JSONDecodeError:
        pass

    # Walk the prefix and record open brackets / string state.
    stack: list[str] = []
    in_string = False
    escape = False
    for ch in text:
        if in_string:
            if escape:
                escape = False
            elif ch == "\\":
                escape = True
            elif ch == '"':
                in_string = False
        elif ch == '"':
            in_string = True
        elif ch in "{[":
            stack.append("}" if ch == "{" else "]")
        elif ch in "}]" and stack:
            stack.pop()

    candidate = text
    if in_string:
        if escape:
            candidate = candidate[:-1]
        candidate += '"'

    for _ in range(4):
        try:
            value = json.loads(candidate + "".join(reversed(stack)))
            return value if isinstance(value, dict) else None
        except json.JSONDecodeError:
            for pattern in _TRAILING_JUNK:
                trimmed = pattern.sub("", candidate)
                if trimmed != candidate:
                    candidate = trimmed
                    break
            else:
                return None
    return None


# ---------------------------------------------------------------------------
# Spoiler guard
# ---------------------------------------------------------------------------

_FENCE = re.compile(r"```|~~~")
_FUNC_HEADER = re.compile(
    r"""(
        ^\s*def\s+\w+\s*\(.*\)\s*(->.*)?:\s*$          # python def
      | \bfunction\s+\w*\s*\(.*\)\s*\{                   # js function
      | ^\s*(public|private|protected|static)\b.*\(.*\)\s*\{   # java / c#
      | ^\s*(int|void|bool|long|string|vector<.*>|auto)\s+\w+\s*\(.*\)\s*\{  # c / c++
      | ^\s*fn\s+\w+\s*\(.*\).*\{                        # rust
      | ^\s*func\s+\w+\s*\(.*\).*\{                      # go
      | \bclass\s+Solution\b
      | ^\s*\#include\s*<
    )""",
    re.VERBOSE | re.MULTILINE,
)
_CODE_LINE = re.compile(
    r"""(
        ;\s*$                                  # statement terminator
      | [{}]\s*$                               # brace at end of line
      | ^\s*(for|while|if|elif|else|return|def|class)\b.*[:{]\s*$
      | ^\s*return\b
    )""",
    # Plain assignments ("sum = 7") are deliberately NOT counted: worked
    # examples legitimately show intermediate values that way.
    re.VERBOSE,
)


def _code_like_lines(text: str) -> int:
    count = 0
    for line in text.splitlines():
        # Trace tables and ASCII sketches use pipes / box chars: not code.
        if "|" in line or not line.strip():
            continue
        if _CODE_LINE.search(line):
            count += 1
    return count


def find_spoiler(value: Any) -> str | None:
    """Return a reason string if any text field looks like solution code."""
    for text in _strings(value):
        if _FENCE.search(text):
            return "fenced_code_block"
        if _FUNC_HEADER.search(text):
            return "function_definition"
        if _code_like_lines(text) >= 3:
            return "multi_line_code"
    return None


def _strings(value: Any):
    if isinstance(value, str):
        yield value
    elif isinstance(value, dict):
        for v in value.values():
            yield from _strings(v)
    elif isinstance(value, list):
        for v in value:
            yield from _strings(v)


def strip_code(text: str) -> str:
    """Last-resort scrub used only if the regenerate also leaked code."""
    text = re.sub(r"```.*?(```|$)", "[code removed: try writing this part yourself]", text, flags=re.S)
    kept = [
        line for line in text.splitlines()
        if "|" in line or not (_CODE_LINE.search(line) or _FUNC_HEADER.search(line))
    ]
    return "\n".join(kept).strip() or "[code removed: try writing this part yourself]"


# ---------------------------------------------------------------------------
# Length shaping
# ---------------------------------------------------------------------------


def clamp_words(text: str, limit: int) -> str:
    """Trim text that overshoots its word limit by more than ~15%."""
    words = text.split()
    if len(words) <= int(limit * 1.15) + 1:
        return text.strip()
    # Keep line structure (tables / bullets) while counting words.
    out, used = [], 0
    for line in text.strip().splitlines():
        n = len(line.split())
        if used + n > limit:
            room = limit - used
            if room > 3:
                out.append(" ".join(line.split()[:room]) + "…")
            break
        out.append(line)
        used += n
    return "\n".join(out).strip()
