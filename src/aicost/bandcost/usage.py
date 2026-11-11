"""Read a usage export: CSV or JSON Lines, one record per API request.

Required fields: model, input_tokens, output_tokens. Optional: provider. Other columns or
keys are ignored, because real exports carry extras. Token counts must be non-negative
whole numbers, at most MAX_TOKENS. Every problem found in a file is reported together, with
line numbers. A file the reader cannot read is a reported problem, never an exception. See
SPEC.md, "Usage export format".
"""

from __future__ import annotations

import csv
import io
import json
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from aicost.core.text import ECHO_LIMIT, safe_text

REQUIRED_FIELDS = ("model", "input_tokens", "output_tokens")
# The most one token count may hold: one quadrillion. A real request is under 10 million
# tokens; the limit keeps every cost inside exact Decimal arithmetic and means a count is
# never parsed from thousands of digits.
MAX_TOKENS = 10**15
_MAX_DIGITS = len(str(MAX_TOKENS))
_DIGITS = re.compile(r"[0-9]+")


class _Oversized:
    """Stands in for a JSON integer with too many digits to read, so no huge int is built."""

    __slots__ = ("negative",)

    def __init__(self, negative: bool):
        self.negative = negative


def _parse_json_int(text: str) -> int | _Oversized:
    if len(text.lstrip("-")) > _MAX_DIGITS:
        return _Oversized(negative=text.startswith("-"))
    return int(text)


def _describe(value: Any) -> str:
    """Say what a rejected value was without printing a container or a long number."""
    if isinstance(value, _Oversized):
        return "a number with too many digits"
    if value is None or isinstance(value, (bool, int, float, str)):
        return safe_text(repr(value), ECHO_LIMIT)
    if isinstance(value, list):
        return "a list"
    if isinstance(value, dict):
        return "an object"
    return f"a value of type {type(value).__name__}"


@dataclass(frozen=True, slots=True, kw_only=True)
class UsageRecord:
    line: int
    provider: str | None
    model: str
    input_tokens: int
    output_tokens: int


class UsageError(ValueError):
    """The usage export is invalid. `problems` lists every problem found."""

    def __init__(self, problems: list[str]):
        self.problems = list(problems)
        super().__init__("; ".join(self.problems))


def _count(value: Any, name: str, line: int, problems: list[str], text_ok: bool) -> int | None:
    """Accept a non-negative whole number: CSV text of ASCII digits, or a JSON integer.

    `text_ok` is true for CSV, where every field is text. In JSON Lines a string is rejected.
    """
    too_large = False
    number = None
    if text_ok and isinstance(value, str):
        text = value.strip()
        if _DIGITS.fullmatch(text):
            digits = text.lstrip("0") or "0"  # leading zeros are not digits that count
            if len(digits) > _MAX_DIGITS:
                too_large = True
            else:
                number = int(digits)
    elif isinstance(value, _Oversized):
        too_large = not value.negative
    elif isinstance(value, int) and not isinstance(value, bool) and value >= 0:
        number = value
    if too_large or (number is not None and number > MAX_TOKENS):
        problems.append(f"line {line}: {name} is too large; the most allowed is {MAX_TOKENS:,}")
        return None
    if number is None:
        problems.append(
            f"line {line}: {name} must be a non-negative whole number, got {_describe(value)}"
        )
    return number


def _record(
    raw: dict[str, Any], line: int, problems: list[str], text_ok: bool
) -> UsageRecord | None:
    start = len(problems)
    model = raw.get("model")
    if not isinstance(model, str) or not model.strip():
        problems.append(f"line {line}: model must be a non-empty string")
    provider = raw.get("provider")
    if provider is not None and provider != "":
        if not isinstance(provider, str) or not provider.strip():
            problems.append(f"line {line}: provider, when present, must be a non-empty string")
    else:
        provider = None
    input_tokens = _count(raw.get("input_tokens"), "input_tokens", line, problems, text_ok)
    output_tokens = _count(raw.get("output_tokens"), "output_tokens", line, problems, text_ok)
    if len(problems) != start:
        return None
    return UsageRecord(
        line=line,
        provider=provider.strip() if provider else None,
        model=model.strip(),
        input_tokens=input_tokens,
        output_tokens=output_tokens,
    )


def parse_usage_csv(text: str) -> tuple[UsageRecord, ...]:
    """Parse CSV text with a header row. Raises UsageError listing every problem."""
    problems: list[str] = []
    reader = csv.reader(io.StringIO(text))
    try:
        header = next(reader, None)
    except csv.Error as error:
        raise UsageError([f"line {reader.line_num}: not valid CSV: {error}"]) from error
    if header is None:
        raise UsageError(["the CSV file is empty; it needs a header row"])
    names = [name.strip() for name in header]
    for name in sorted({n for n in names if names.count(n) > 1}):
        problems.append(f"header: duplicate column {name!r}")
    for name in REQUIRED_FIELDS:
        if name not in names:
            problems.append(f"header: missing required column {name!r}")
    if problems:
        raise UsageError(problems)

    records: list[UsageRecord] = []
    while True:
        try:
            fields = next(reader, None)
        except csv.Error as error:
            problems.append(f"line {reader.line_num}: not valid CSV: {error}")
            break
        if fields is None:
            break
        line = reader.line_num
        if not fields or (len(fields) == 1 and not fields[0].strip()):  # a blank line
            continue
        if len(fields) != len(names):
            problems.append(f"line {line}: expected {len(names)} fields, found {len(fields)}")
            continue
        record = _record(dict(zip(names, fields)), line, problems, text_ok=True)
        if record is not None:
            records.append(record)

    if problems:
        raise UsageError(problems)
    if not records:
        raise UsageError(["the CSV file has a header but no usage records"])
    return tuple(records)


def parse_usage_jsonl(text: str) -> tuple[UsageRecord, ...]:
    """Parse JSON Lines text (one object per line, blank lines and whitespace-only lines skipped)."""
    problems: list[str] = []
    records: list[UsageRecord] = []
    for line, content in enumerate(text.split("\n"), start=1):
        if not content.strip():
            continue
        try:
            raw = json.loads(content, parse_int=_parse_json_int)
        except json.JSONDecodeError as error:
            problems.append(f"line {line}: not valid JSON: {safe_text(error.msg)}")
            continue
        except RecursionError:
            problems.append(f"line {line}: JSON is nested too deeply to read")
            continue
        if not isinstance(raw, dict):
            problems.append(f"line {line}: each line must be a JSON object")
            continue
        record = _record(raw, line, problems, text_ok=False)
        if record is not None:
            records.append(record)

    if problems:
        raise UsageError(problems)
    if not records:
        raise UsageError(["the JSON Lines file has no usage records"])
    return tuple(records)


def load_usage(path: str | Path, fmt: str | None = None) -> tuple[UsageRecord, ...]:
    """Read a UTF-8 usage file. `fmt` is "csv" or "jsonl"; by default the suffix decides."""
    path = Path(path)
    if fmt is None:
        fmt = {".csv": "csv", ".jsonl": "jsonl"}.get(path.suffix.lower())
    if fmt not in ("csv", "jsonl"):
        raise UsageError([f"cannot tell the format of {safe_text(path.name)}; use .csv or .jsonl"])
    try:
        # utf-8-sig drops a leading byte order mark, which spreadsheet exports often add.
        text = path.read_text(encoding="utf-8-sig")
    except UnicodeDecodeError as error:
        raise UsageError([f"{safe_text(path.name)} is not valid UTF-8: {error.reason}"]) from error
    return parse_usage_csv(text) if fmt == "csv" else parse_usage_jsonl(text)
