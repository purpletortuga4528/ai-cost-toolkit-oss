"""Choose the price row that applies to a usage record on a given date."""

from __future__ import annotations

import datetime
from dataclasses import dataclass

from aicost.bandcost.usage import UsageRecord
from aicost.core import PriceRow

UNPRICED = "no price row for this model"
AMBIGUOUS = "model appears under more than one provider; add a provider column"
NOT_YET_EFFECTIVE = "every price row for this model takes effect after the pricing date"


@dataclass(frozen=True, slots=True, kw_only=True)
class Selection:
    row: PriceRow | None
    reason: str | None


def select_row(rows: tuple[PriceRow, ...], record: UsageRecord, on: datetime.date) -> Selection:
    """Pick the row with the latest effective_from that is not after `on`.

    Models match by exact, case-sensitive name. A record that names a provider matches only
    that provider. A record without one matches any provider, and if the model is found
    under more than one provider the answer is ambiguous, never a guess.
    """
    candidates = [
        row
        for row in rows
        if row.model == record.model and (record.provider is None or row.provider == record.provider)
    ]
    if not candidates:
        return Selection(row=None, reason=UNPRICED)
    if len({row.provider for row in candidates}) > 1:
        return Selection(row=None, reason=AMBIGUOUS)
    current = [row for row in candidates if row.effective_from <= on]
    if not current:
        return Selection(row=None, reason=NOT_YET_EFFECTIVE)
    return Selection(row=max(current, key=lambda row: row.effective_from), reason=None)
