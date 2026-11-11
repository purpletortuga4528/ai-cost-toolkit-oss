"""Price-table row type and validator.

A price table is a list of rows. Each row gives the rates, in US dollars per million
tokens, for one model from one effective-from date, with the provenance fields that the
stale-data warning needs. See SPEC.md, "Data format".
"""

from __future__ import annotations

import datetime
from dataclasses import dataclass
from decimal import Decimal
from typing import Any
from urllib.parse import urlsplit

from aicost.core.text import ECHO_LIMIT, safe_text

SCHEMA_VERSION = 1
DEFAULT_SHELF_LIFE_DAYS = 30
BOUNDARY_RULES = ("at_or_below", "under")
APPLIES_TO = ("whole_request", "marginal")
SHIPPED_TIERS = ("A", "B", "C")
# The highest rate a row may hold, in US dollars per million tokens. Real rates are under
# about $1,000; the limit keeps every cost inside exact Decimal arithmetic.
MAX_RATE_PER_MTOK = Decimal(1_000_000)

_REQUIRED = (
    "provider",
    "model",
    "effective_from",
    "input_per_mtok",
    "output_per_mtok",
    "source_url",
    "as_of",
    "tier",
)
_BAND_KEYS = (
    "threshold_tokens",
    "boundary",
    "applies_to",
    "input_per_mtok_above",
    "output_per_mtok_above",
)
_OPTIONAL = ("shelf_life_days", "notes")
_KNOWN = frozenset(_REQUIRED + _BAND_KEYS + _OPTIONAL)


@dataclass(frozen=True, slots=True, kw_only=True)
class PriceRow:
    provider: str
    model: str
    effective_from: datetime.date
    input_per_mtok: Decimal
    output_per_mtok: Decimal
    threshold_tokens: int | None
    boundary: str | None
    applies_to: str | None
    input_per_mtok_above: Decimal | None
    output_per_mtok_above: Decimal | None
    source_url: str
    as_of: datetime.date
    tier: str
    shelf_life_days: int
    notes: str


@dataclass(frozen=True, slots=True, kw_only=True)
class PriceWarning:
    kind: str
    provider: str
    model: str
    effective_from: datetime.date
    message: str


class PriceTableError(ValueError):
    """The price table is invalid. `problems` lists every problem found."""

    def __init__(self, problems: list[str]):
        self.problems = list(problems)
        super().__init__("; ".join(self.problems))


def _is_int(value: Any) -> bool:
    return isinstance(value, int) and not isinstance(value, bool)


def _is_date(value: Any) -> bool:
    # datetime.datetime is a subclass of datetime.date, so exclude it explicitly.
    return isinstance(value, datetime.date) and not isinstance(value, datetime.datetime)


def _rate(value: Any, name: str, problems: list[str], where: str) -> Decimal | None:
    """Accept an int or Decimal that is finite, not negative, and at most MAX_RATE_PER_MTOK.

    A float is rejected: the loader parses TOML floats as Decimal, so a float here
    means the caller bypassed that and the value may already be inexact.
    """
    if not (_is_int(value) or isinstance(value, Decimal)):
        problems.append(f"{where}: {name} must be a number, not {type(value).__name__}")
        return None
    rate = Decimal(value)
    if not rate.is_finite() or rate < 0:
        problems.append(f"{where}: {name} must be finite and not negative")
        return None
    if rate > MAX_RATE_PER_MTOK:
        problems.append(f"{where}: {name} must be at most {MAX_RATE_PER_MTOK:,} dollars per million tokens")
        return None
    return rate


def _text(value: Any, name: str, problems: list[str], where: str) -> str | None:
    if not isinstance(value, str) or not value.strip():
        problems.append(f"{where}: {name} must be a non-empty string")
        return None
    return value


def validate_row(raw: Any, index: int, today: datetime.date, problems: list[str]) -> PriceRow | None:
    """Validate one raw row. Append every problem found; return a row only if none."""
    where = f"row {index}"
    if not isinstance(raw, dict):
        problems.append(f"{where}: must be a table")
        return None
    label = f"{safe_text(raw.get('provider'), ECHO_LIMIT)}/{safe_text(raw.get('model'), ECHO_LIMIT)}"
    where = f"row {index} ({label})"
    start = len(problems)

    for key in sorted(set(raw) - _KNOWN):
        problems.append(f"{where}: unknown key {safe_text(repr(key), ECHO_LIMIT)}")
    for key in _REQUIRED:
        if key not in raw:
            problems.append(f"{where}: missing required key {key!r}")

    provider = _text(raw["provider"], "provider", problems, where) if "provider" in raw else None
    model = _text(raw["model"], "model", problems, where) if "model" in raw else None

    effective_from = raw.get("effective_from")
    if "effective_from" in raw and not _is_date(effective_from):
        problems.append(f"{where}: effective_from must be a date such as 2027-01-01")

    as_of = raw.get("as_of")
    if "as_of" in raw:
        if not _is_date(as_of):
            problems.append(f"{where}: as_of must be a date such as 2026-10-31")
        elif as_of > today:
            problems.append(f"{where}: as_of {as_of} is in the future")

    input_rate = _rate(raw["input_per_mtok"], "input_per_mtok", problems, where) if "input_per_mtok" in raw else None
    output_rate = _rate(raw["output_per_mtok"], "output_per_mtok", problems, where) if "output_per_mtok" in raw else None

    source_url = None
    if "source_url" in raw:
        source_url = _text(raw["source_url"], "source_url", problems, where)
        if source_url is not None:
            parts = urlsplit(source_url)
            if parts.scheme not in ("http", "https") or not parts.netloc:
                problems.append(f"{where}: source_url must be an http or https URL")

    tier = raw.get("tier")
    if "tier" in raw:
        if tier == "X":
            problems.append(f"{where}: tier X is not shipped; remove the row")
        elif tier not in SHIPPED_TIERS:
            problems.append(f"{where}: tier must be one of {', '.join(SHIPPED_TIERS)}")

    shelf_life = raw.get("shelf_life_days", DEFAULT_SHELF_LIFE_DAYS)
    if not _is_int(shelf_life) or shelf_life <= 0:
        problems.append(f"{where}: shelf_life_days must be a positive integer")

    notes = raw.get("notes", "")
    if not isinstance(notes, str):
        problems.append(f"{where}: notes must be a string")

    # Band keys: all four present (two bands) or all four absent (one band).
    present = [key for key in _BAND_KEYS if key in raw]
    threshold = raw.get("threshold_tokens")
    boundary = raw.get("boundary")
    applies_to = raw.get("applies_to")
    above_in = above_out = None
    if present and len(present) != len(_BAND_KEYS):
        missing = [key for key in _BAND_KEYS if key not in raw]
        problems.append(
            f"{where}: band keys go together; present {present}, missing {missing}"
        )
    elif present:
        if not _is_int(threshold) or threshold <= 0:
            problems.append(f"{where}: threshold_tokens must be a positive integer")
        if boundary not in BOUNDARY_RULES:
            problems.append(f"{where}: boundary must be one of {', '.join(BOUNDARY_RULES)}")
        if applies_to not in APPLIES_TO:
            problems.append(f"{where}: applies_to must be one of {', '.join(APPLIES_TO)}")
        above_in = _rate(raw["input_per_mtok_above"], "input_per_mtok_above", problems, where)
        above_out = _rate(raw["output_per_mtok_above"], "output_per_mtok_above", problems, where)

    if len(problems) != start:
        return None
    return PriceRow(
        provider=provider,
        model=model,
        effective_from=effective_from,
        input_per_mtok=input_rate,
        output_per_mtok=output_rate,
        threshold_tokens=threshold if present else None,
        boundary=boundary if present else None,
        applies_to=applies_to if present else None,
        input_per_mtok_above=above_in,
        output_per_mtok_above=above_out,
        source_url=source_url,
        as_of=as_of,
        tier=tier,
        shelf_life_days=shelf_life,
        notes=notes,
    )


def validate_rows(raw_rows: Any, today: datetime.date) -> tuple[PriceRow, ...]:
    """Validate raw rows, report every problem together, and return typed rows."""
    problems: list[str] = []
    if not isinstance(raw_rows, list) or not raw_rows:
        raise PriceTableError(["the table needs at least one [[price]] row"])

    rows: list[PriceRow] = []
    seen: dict[tuple[str, str, datetime.date], int] = {}
    for index, raw in enumerate(raw_rows, start=1):
        row = validate_row(raw, index, today, problems)
        if row is None:
            continue
        key = (row.provider, row.model, row.effective_from)
        if key in seen:
            problems.append(
                f"row {index} ({row.provider}/{row.model}): duplicates row {seen[key]} "
                f"(same provider, model, and effective_from)"
            )
        else:
            seen[key] = index
        rows.append(row)

    if problems:
        raise PriceTableError(problems)
    return tuple(rows)


def tier_warnings(rows: tuple[PriceRow, ...]) -> list[PriceWarning]:
    """Tier C rows rest on a single, self-interested or contested source."""
    return [
        PriceWarning(
            kind="tier_c",
            provider=row.provider,
            model=row.model,
            effective_from=row.effective_from,
            message="tier C: single, self-interested or contested source; treat with care",
        )
        for row in rows
        if row.tier == "C"
    ]
