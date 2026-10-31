"""Spend by band: totals per provider, model, and price row, plus unpriced records."""

from __future__ import annotations

import datetime
from dataclasses import dataclass, field
from decimal import Decimal

from aicost.bandcost.arithmetic import price_request
from aicost.bandcost.lookup import select_row
from aicost.bandcost.usage import UsageRecord
from aicost.core import PriceRow


@dataclass(slots=True, kw_only=True)
class BandSpend:
    """Totals for the requests priced by one row."""

    row: PriceRow
    requests: int = 0
    requests_upper: int = 0
    input_tokens: int = 0
    output_tokens: int = 0
    upper_input_tokens: int = 0
    banded_cost: Decimal = Decimal(0)
    headline_cost: Decimal = Decimal(0)
    upper_band_spend: Decimal = Decimal(0)  # banded cost of requests in the upper band
    upper_rate_cost: Decimal = Decimal(0)  # cost of the tokens priced at upper rates

    @property
    def gap(self) -> Decimal:
        """Banded cost minus the cost at the headline (lower band) rate."""
        return self.banded_cost - self.headline_cost

    @property
    def share_above(self) -> Decimal | None:
        """Fraction (0 to 1) of banded spend on requests in the upper band.

        None when the row has no threshold, or when there is no spend to divide.
        """
        if self.row.threshold_tokens is None or self.banded_cost == 0:
            return None
        return self.upper_band_spend / self.banded_cost


@dataclass(frozen=True, slots=True, kw_only=True)
class Unpriced:
    record: UsageRecord
    reason: str


@dataclass(slots=True, kw_only=True)
class SpendReport:
    pricing_date: datetime.date
    groups: list[BandSpend] = field(default_factory=list)
    unpriced: list[Unpriced] = field(default_factory=list)

    @property
    def banded_cost(self) -> Decimal:
        return sum((g.banded_cost for g in self.groups), Decimal(0))

    @property
    def headline_cost(self) -> Decimal:
        return sum((g.headline_cost for g in self.groups), Decimal(0))

    @property
    def gap(self) -> Decimal:
        return self.banded_cost - self.headline_cost


def spend_by_band(
    records: tuple[UsageRecord, ...], rows: tuple[PriceRow, ...], on: datetime.date
) -> SpendReport:
    """Price every record under the row in force on `on` and total by row.

    Records that cannot be priced are listed in `unpriced` with a reason, never dropped.
    """
    report = SpendReport(pricing_date=on)
    by_row: dict[tuple[str, str, datetime.date], BandSpend] = {}
    for record in records:
        selection = select_row(rows, record, on)
        if selection.row is None:
            report.unpriced.append(Unpriced(record=record, reason=selection.reason))
            continue
        row = selection.row
        key = (row.provider, row.model, row.effective_from)
        group = by_row.get(key)
        if group is None:
            group = by_row[key] = BandSpend(row=row)
            report.groups.append(group)
        cost = price_request(row, record.input_tokens, record.output_tokens)
        group.requests += 1
        group.requests_upper += cost.in_upper_band
        group.input_tokens += cost.input_tokens
        group.output_tokens += cost.output_tokens
        group.upper_input_tokens += cost.upper_input_tokens
        group.banded_cost += cost.total
        group.headline_cost += cost.headline_cost
        if cost.in_upper_band:
            group.upper_band_spend += cost.total
        group.upper_rate_cost += cost.upper_rate_cost
    return report
