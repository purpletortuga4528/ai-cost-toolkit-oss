"""Hand-computed band arithmetic, including a request exactly at the threshold.

Synthetic rows only: the provider, rates, and thresholds are made up. Rates in dollars per
million tokens: lower band input 1, output 2; upper band input 3, output 6; threshold
200,000 tokens. Every expected value below was worked out by hand (tokens x rate / 1e6),
not produced by the code under test.
"""

import datetime
import unittest
from decimal import Decimal

from aicost.bandcost import is_upper_band, price_request, upper_input_tokens
from aicost.core.schema import PriceRow

D = Decimal


def make_row(boundary="at_or_below", applies_to="whole_request", threshold=200000):
    banded = threshold is not None
    return PriceRow(
        provider="example-provider",
        model="example-model",
        effective_from=datetime.date(2026, 1, 1),
        input_per_mtok=D(1),
        output_per_mtok=D(2),
        threshold_tokens=threshold,
        boundary=boundary if banded else None,
        applies_to=applies_to if banded else None,
        input_per_mtok_above=D(3) if banded else None,
        output_per_mtok_above=D(6) if banded else None,
        source_url="https://example.com/pricing",
        as_of=datetime.date(2026, 10, 31),
        tier="A",
        shelf_life_days=30,
        notes="",
    )


OUT = 1000  # output tokens in every case below


class WholeRequestAtOrBelow(unittest.TestCase):
    row = make_row("at_or_below", "whole_request")

    def test_one_below_the_threshold(self):
        # 199,999 x 1 + 1,000 x 2 = 0.199999 + 0.002
        cost = price_request(self.row, 199999, OUT)
        self.assertFalse(cost.in_upper_band)
        self.assertEqual(cost.total, D("0.201999"))
        self.assertEqual(cost.upper_rate_cost, 0)

    def test_exactly_at_the_threshold_stays_lower(self):
        # 200,000 x 1 + 1,000 x 2 = 0.2 + 0.002
        cost = price_request(self.row, 200000, OUT)
        self.assertFalse(cost.in_upper_band)
        self.assertEqual(cost.total, D("0.202"))
        self.assertEqual(cost.headline_cost, D("0.202"))

    def test_one_above_the_threshold_reprices_everything(self):
        # 200,001 x 3 + 1,000 x 6 = 0.600003 + 0.006
        cost = price_request(self.row, 200001, OUT)
        self.assertTrue(cost.in_upper_band)
        self.assertEqual(cost.input_cost, D("0.600003"))
        self.assertEqual(cost.output_cost, D("0.006"))
        self.assertEqual(cost.total, D("0.606003"))
        self.assertEqual(cost.upper_rate_cost, D("0.606003"))
        # Headline: 200,001 x 1 + 1,000 x 2 = 0.200001 + 0.002
        self.assertEqual(cost.headline_cost, D("0.202001"))


class WholeRequestUnder(unittest.TestCase):
    row = make_row("under", "whole_request")

    def test_one_below_the_threshold(self):
        cost = price_request(self.row, 199999, OUT)
        self.assertFalse(cost.in_upper_band)
        self.assertEqual(cost.total, D("0.201999"))

    def test_exactly_at_the_threshold_is_upper(self):
        # 200,000 x 3 + 1,000 x 6 = 0.6 + 0.006
        cost = price_request(self.row, 200000, OUT)
        self.assertTrue(cost.in_upper_band)
        self.assertEqual(cost.total, D("0.606"))
        self.assertEqual(cost.headline_cost, D("0.202"))

    def test_one_above_the_threshold(self):
        cost = price_request(self.row, 200001, OUT)
        self.assertTrue(cost.in_upper_band)
        self.assertEqual(cost.total, D("0.606003"))


class MarginalAtOrBelow(unittest.TestCase):
    row = make_row("at_or_below", "marginal")

    def test_one_below_and_exactly_at_the_threshold(self):
        below = price_request(self.row, 199999, OUT)
        at = price_request(self.row, 200000, OUT)
        self.assertEqual((below.upper_input_tokens, below.total), (0, D("0.201999")))
        self.assertEqual((at.upper_input_tokens, at.total), (0, D("0.202")))
        self.assertFalse(at.in_upper_band)

    def test_one_above_prices_one_token_at_the_upper_rate(self):
        # lower: 200,000 x 1 = 0.2; upper: 1 x 3 = 0.000003; output at the upper band
        # rate: 1,000 x 6 = 0.006. Total 0.206003.
        cost = price_request(self.row, 200001, OUT)
        self.assertTrue(cost.in_upper_band)
        self.assertEqual(cost.upper_input_tokens, 1)
        self.assertEqual(cost.input_cost, D("0.200003"))
        self.assertEqual(cost.output_cost, D("0.006"))
        self.assertEqual(cost.total, D("0.206003"))
        self.assertEqual(cost.upper_rate_cost, D("0.006003"))
        self.assertEqual(cost.headline_cost, D("0.202001"))

    def test_well_above(self):
        # 250,000 in: 200,000 x 1 = 0.2, 50,000 x 3 = 0.15, out 1,000 x 6 = 0.006.
        cost = price_request(self.row, 250000, OUT)
        self.assertEqual(cost.upper_input_tokens, 50000)
        self.assertEqual(cost.total, D("0.356"))
        self.assertEqual(cost.upper_rate_cost, D("0.156"))


class MarginalUnder(unittest.TestCase):
    row = make_row("under", "marginal")

    def test_one_below_the_threshold(self):
        cost = price_request(self.row, 199999, OUT)
        self.assertEqual((cost.upper_input_tokens, cost.total), (0, D("0.201999")))
        self.assertFalse(cost.in_upper_band)

    def test_exactly_at_the_threshold_prices_the_boundary_token_upper(self):
        # lower: 199,999 x 1 = 0.199999; upper: 1 x 3 = 0.000003; out 1,000 x 6 = 0.006.
        cost = price_request(self.row, 200000, OUT)
        self.assertTrue(cost.in_upper_band)
        self.assertEqual(cost.upper_input_tokens, 1)
        self.assertEqual(cost.total, D("0.206002"))

    def test_one_above_the_threshold(self):
        # lower: 199,999 x 1 = 0.199999; upper: 2 x 3 = 0.000006; out 0.006.
        cost = price_request(self.row, 200001, OUT)
        self.assertEqual(cost.upper_input_tokens, 2)
        self.assertEqual(cost.total, D("0.206005"))


class OtherCases(unittest.TestCase):
    def test_single_band_row_never_has_an_upper_band(self):
        row = make_row(threshold=None)
        cost = price_request(row, 5_000_000, OUT)
        self.assertFalse(cost.in_upper_band)
        # 5,000,000 x 1 + 1,000 x 2 = 5 + 0.002
        self.assertEqual(cost.total, D("5.002"))
        self.assertEqual(cost.total, cost.headline_cost)
        self.assertEqual(upper_input_tokens(row, 5_000_000), 0)
        self.assertFalse(is_upper_band(row, 5_000_000))

    def test_zero_tokens(self):
        for boundary in ("at_or_below", "under"):
            for applies_to in ("whole_request", "marginal"):
                with self.subTest(boundary=boundary, applies_to=applies_to):
                    cost = price_request(make_row(boundary, applies_to), 0, 0)
                    self.assertEqual(cost.total, 0)
                    self.assertFalse(cost.in_upper_band)

    def test_output_tokens_never_decide_the_band(self):
        # 100 in, 5,000,000 out: still the lower band. 100 x 1 + 5,000,000 x 2 = 0.0001 + 10.
        cost = price_request(make_row(), 100, 5_000_000)
        self.assertFalse(cost.in_upper_band)
        self.assertEqual(cost.total, D("10.0001"))

    def test_other_threshold_under_rule(self):
        # Threshold 270,000, rule "under": exactly 270,000 is upper.
        row = make_row("under", "whole_request", threshold=270000)
        self.assertFalse(is_upper_band(row, 269999))
        self.assertTrue(is_upper_band(row, 270000))
        # 270,000 x 3 + 0 = 0.81
        self.assertEqual(price_request(row, 270000, 0).total, D("0.81"))

    def test_rates_stay_exact(self):
        # 3 tokens at $0.1 per million is 0.0000003; a float would not be exact.
        row = make_row(threshold=None)
        row = PriceRow(**{**{f: getattr(row, f) for f in row.__slots__}, "input_per_mtok": D("0.1")})
        self.assertEqual(price_request(row, 3, 0).total, D("0.0000003"))

    def test_negative_tokens_are_rejected(self):
        with self.assertRaises(ValueError):
            price_request(make_row(), -1, 0)


if __name__ == "__main__":
    unittest.main()
