"""Stale-data warning: a row is stale when its as-of date is older than its shelf life."""

from __future__ import annotations

import datetime

from aicost.core.schema import PriceRow, PriceWarning


def stale_warnings(rows: tuple[PriceRow, ...], today: datetime.date) -> list[PriceWarning]:
    """Warn for each row whose age in days is greater than its shelf life.

    A row exactly at its shelf life is not stale. `today` is a parameter so that
    results do not depend on the clock.
    """
    warnings = []
    for row in rows:
        age = (today - row.as_of).days
        if age > row.shelf_life_days:
            warnings.append(
                PriceWarning(
                    kind="stale",
                    provider=row.provider,
                    model=row.model,
                    effective_from=row.effective_from,
                    message=(
                        f"price checked {row.as_of} is {age} days old; "
                        f"shelf life is {row.shelf_life_days} days; source: {row.source_url}"
                    ),
                )
            )
    return warnings
