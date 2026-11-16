"""Read a price table from TOML text or a file."""

from __future__ import annotations

import datetime
import tomllib
from decimal import Decimal
from pathlib import Path

from aicost.core.schema import SCHEMA_VERSION, PriceRow, PriceTableError, validate_rows
from aicost.core.text import ECHO_LIMIT, safe_text


def parse_price_table(text: str, today: datetime.date | None = None) -> tuple[PriceRow, ...]:
    """Parse and validate TOML text. Raises PriceTableError listing every problem."""
    today = today or datetime.date.today()
    try:
        data = tomllib.loads(text, parse_float=Decimal)
    except tomllib.TOMLDecodeError as error:
        raise PriceTableError([f"not valid TOML: {safe_text(error)}"]) from error
    except ValueError as error:
        # Not a TOMLDecodeError: tomllib refuses an integer of more than 4,300 digits this way.
        raise PriceTableError(
            ["not valid TOML: a value could not be read (for example, an integer of more than 4,300 digits)"]
        ) from error
    except ArithmeticError as error:
        # decimal.InvalidOperation (an ArithmeticError, not a ValueError): Decimal refuses an exponent
        # beyond its limits, for example 1e1000000000000000000000, and tomllib lets that escape.
        raise PriceTableError(
            ["not valid TOML: a value could not be read (for example, a number whose exponent is too large)"]
        ) from error
    except RecursionError as error:
        raise PriceTableError(["not valid TOML: nested too deeply to read"]) from error

    problems = []
    if data.get("schema_version") != SCHEMA_VERSION:
        problems.append(f"schema_version must be {SCHEMA_VERSION}")
    for key in sorted(set(data) - {"schema_version", "price"}):
        problems.append(f"unknown top-level key {safe_text(repr(key), ECHO_LIMIT)}")
    try:
        rows = validate_rows(data.get("price"), today)
    except PriceTableError as error:
        raise PriceTableError(problems + error.problems) from error
    if problems:
        raise PriceTableError(problems)
    return rows


def load_price_table(path: str | Path, today: datetime.date | None = None) -> tuple[PriceRow, ...]:
    """Read a UTF-8 TOML file (a leading byte order mark is accepted) and validate it."""
    try:
        text = Path(path).read_text(encoding="utf-8-sig")
    except UnicodeDecodeError as error:
        raise PriceTableError([f"not valid UTF-8 (at byte {error.start}): {error.reason}"]) from error
    return parse_price_table(text, today)
