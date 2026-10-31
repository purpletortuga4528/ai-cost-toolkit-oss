"""Read a price table from TOML text or a file."""

from __future__ import annotations

import datetime
import tomllib
from decimal import Decimal
from pathlib import Path

from aicost.core.schema import SCHEMA_VERSION, PriceRow, PriceTableError, validate_rows


def parse_price_table(text: str, today: datetime.date | None = None) -> tuple[PriceRow, ...]:
    """Parse and validate TOML text. Raises PriceTableError listing every problem."""
    today = today or datetime.date.today()
    try:
        data = tomllib.loads(text, parse_float=Decimal)
    except tomllib.TOMLDecodeError as error:
        raise PriceTableError([f"not valid TOML: {error}"]) from error

    problems = []
    if data.get("schema_version") != SCHEMA_VERSION:
        problems.append(f"schema_version must be {SCHEMA_VERSION}")
    for key in sorted(set(data) - {"schema_version", "price"}):
        problems.append(f"unknown top-level key {key!r}")
    try:
        rows = validate_rows(data.get("price"), today)
    except PriceTableError as error:
        raise PriceTableError(problems + error.problems) from error
    if problems:
        raise PriceTableError(problems)
    return rows


def load_price_table(path: str | Path, today: datetime.date | None = None) -> tuple[PriceRow, ...]:
    """Read a UTF-8 TOML file and validate it."""
    text = Path(path).read_text(encoding="utf-8")
    return parse_price_table(text, today)
