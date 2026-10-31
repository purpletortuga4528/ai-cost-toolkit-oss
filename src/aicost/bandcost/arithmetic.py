"""Band arithmetic: what one request costs under a price row.

The count compared with the threshold is the request's input tokens. See SPEC.md, "Band
arithmetic". These are modeling definitions, not claims about any provider.

Rates are US dollars per million tokens. Cost is tokens times rate divided by 1,000,000 in
exact Decimal, with no rounding.
"""

from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal

from aicost.core import PriceRow

_MILLION = Decimal(1_000_000)


@dataclass(frozen=True, slots=True, kw_only=True)
class RequestCost:
    input_tokens: int
    output_tokens: int
    in_upper_band: bool
    upper_input_tokens: int
    input_cost: Decimal
    output_cost: Decimal
    headline_cost: Decimal
    upper_rate_cost: Decimal

    @property
    def total(self) -> Decimal:
        """Banded cost: input plus output."""
        return self.input_cost + self.output_cost


def upper_input_tokens(row: PriceRow, input_tokens: int) -> int:
    """How many input tokens are priced at the upper input rate.

    whole_request: all of them when the request is in the upper band, otherwise none.
    marginal: token number p is upper when a request of p tokens would be in the upper band,
    so max(0, n - T) tokens under at_or_below, and max(0, n - T + 1) under under.
    """
    if row.threshold_tokens is None:
        return 0
    if row.applies_to == "whole_request":
        return input_tokens if is_upper_band(row, input_tokens) else 0
    extra = 1 if row.boundary == "under" else 0
    return max(0, input_tokens - row.threshold_tokens + extra)


def is_upper_band(row: PriceRow, input_tokens: int) -> bool:
    """Is a request with this many input tokens in the upper band?

    at_or_below: lower band when n <= T. under: lower band when n < T. A single-band row
    has no upper band.
    """
    if row.threshold_tokens is None:
        return False
    if row.boundary == "at_or_below":
        return input_tokens > row.threshold_tokens
    return input_tokens >= row.threshold_tokens


def price_request(row: PriceRow, input_tokens: int, output_tokens: int) -> RequestCost:
    """Price one request under one row.

    Output tokens never decide the band. They are all priced at the output rate of the band
    the request's input falls in, under both applies_to values.
    """
    if input_tokens < 0 or output_tokens < 0:
        raise ValueError("token counts must not be negative")
    upper = is_upper_band(row, input_tokens)
    upper_in = upper_input_tokens(row, input_tokens)
    lower_in = input_tokens - upper_in

    input_cost = Decimal(lower_in) * row.input_per_mtok / _MILLION
    upper_input_cost = Decimal(0)
    output_rate = row.output_per_mtok
    upper_output_cost = Decimal(0)
    if upper:
        upper_input_cost = Decimal(upper_in) * row.input_per_mtok_above / _MILLION
        output_rate = row.output_per_mtok_above
        upper_output_cost = Decimal(output_tokens) * output_rate / _MILLION
    output_cost = Decimal(output_tokens) * output_rate / _MILLION
    headline = (
        Decimal(input_tokens) * row.input_per_mtok + Decimal(output_tokens) * row.output_per_mtok
    ) / _MILLION
    return RequestCost(
        input_tokens=input_tokens,
        output_tokens=output_tokens,
        in_upper_band=upper,
        upper_input_tokens=upper_in,
        input_cost=input_cost + upper_input_cost,
        output_cost=output_cost,
        headline_cost=headline,
        upper_rate_cost=upper_input_cost + upper_output_cost,
    )
