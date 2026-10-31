"""Spend by band, with hand-computed totals. Synthetic rows only."""

import datetime
import unittest
from decimal import Decimal
from pathlib import Path

from aicost.bandcost import UsageRecord, select_row, spend_by_band
from aicost.core import load_price_table
from aicost.core.schema import PriceRow

D = Decimal
FIXTURE = Path(__file__).parent / "fixtures" / "example_prices.toml"
TODAY = datetime.date(2026, 10, 31)


def row(model="m", provider="p", applies_to="whole_request", boundary="at_or_below",
        effective_from=datetime.date(2026, 1, 1)):
    # Lower input 1, output 2; upper input 3, output 6; threshold 200,000 ($ per million).
    return PriceRow(
        provider=provider, model=model, effective_from=effective_from,
        input_per_mtok=D(1), output_per_mtok=D(2), threshold_tokens=200000,
        boundary=boundary, applies_to=applies_to,
        input_per_mtok_above=D(3), output_per_mtok_above=D(6),
        source_url="https://example.com/p", as_of=TODAY, tier="A",
        shelf_life_days=30, notes="",
    )


def usage(model, tokens_in, tokens_out, provider=None, line=1):
    return UsageRecord(line=line, provider=provider, model=model,
                       input_tokens=tokens_in, output_tokens=tokens_out)


RECORDS = (usage("m", 100000, 10000), usage("m", 200000, 0), usage("m", 300000, 10000))


class SpendWholeRequest(unittest.TestCase):
    def test_hand_computed_totals(self):
        # r1: 100,000 x 1 + 10,000 x 2 = 0.1 + 0.02 = 0.12 (headline 0.12)
        # r2: 200,000 x 1 = 0.2, exactly at the threshold, lower band (headline 0.2)
        # r3: 300,000 x 3 + 10,000 x 6 = 0.9 + 0.06 = 0.96 (headline 0.3 + 0.02 = 0.32)
        report = spend_by_band(RECORDS, (row(),), TODAY)
        (group,) = report.groups
        self.assertEqual((group.requests, group.requests_upper), (3, 1))
        self.assertEqual(group.banded_cost, D("1.28"))
        self.assertEqual(group.headline_cost, D("0.64"))
        self.assertEqual(group.gap, D("0.64"))
        self.assertEqual(group.upper_band_spend, D("0.96"))
        self.assertEqual(group.share_above, D("0.75"))
        self.assertEqual(group.upper_rate_cost, D("0.96"))
        self.assertEqual((group.input_tokens, group.output_tokens), (600000, 20000))
        self.assertEqual(report.gap, D("0.64"))

    def test_under_rule_moves_the_boundary_request_up(self):
        # r2 is now upper: 200,000 x 3 = 0.6. Total 0.12 + 0.6 + 0.96 = 1.68; upper 1.56.
        (group,) = spend_by_band(RECORDS, (row(boundary="under"),), TODAY).groups
        self.assertEqual(group.requests_upper, 2)
        self.assertEqual(group.banded_cost, D("1.68"))
        self.assertEqual(group.upper_band_spend, D("1.56"))
        self.assertEqual(group.share_above, D("1.56") / D("1.68"))


class SpendMarginal(unittest.TestCase):
    def test_hand_computed_totals(self):
        # r3 marginal: 200,000 x 1 = 0.2, 100,000 x 3 = 0.3, output 10,000 x 6 = 0.06,
        # so 0.56. r1 and r2 as before. Total 0.12 + 0.2 + 0.56 = 0.88; headline 0.64.
        (group,) = spend_by_band(RECORDS, (row(applies_to="marginal"),), TODAY).groups
        self.assertEqual(group.banded_cost, D("0.88"))
        self.assertEqual(group.gap, D("0.24"))
        self.assertEqual(group.upper_band_spend, D("0.56"))
        self.assertAlmostEqual(float(group.share_above), 7 / 11, places=12)
        self.assertEqual(group.upper_input_tokens, 100000)
        self.assertEqual(group.upper_rate_cost, D("0.36"))  # 0.3 + 0.06


class ShareEdgeCases(unittest.TestCase):
    def test_share_is_none_without_threshold_or_spend(self):
        single = PriceRow(**{**{f: getattr(row(), f) for f in PriceRow.__slots__},
                             "threshold_tokens": None, "boundary": None, "applies_to": None,
                             "input_per_mtok_above": None, "output_per_mtok_above": None})
        (group,) = spend_by_band((usage("m", 5, 5),), (single,), TODAY).groups
        self.assertIsNone(group.share_above)
        self.assertEqual(group.gap, 0)
        (empty,) = spend_by_band((usage("m", 0, 0),), (row(),), TODAY).groups
        self.assertIsNone(empty.share_above)

    def test_no_upper_requests_gives_zero_share(self):
        (group,) = spend_by_band((usage("m", 10, 10),), (row(),), TODAY).groups
        self.assertEqual(group.share_above, 0)


class RowSelection(unittest.TestCase):
    def test_scheduled_change_picks_the_row_in_force(self):
        rows = load_price_table(FIXTURE, TODAY)
        record = usage("example-model-a", 300000, 1000)
        # 2026 row, whole request, upper: 300,000 x 2.5 + 1,000 x 15 = 0.75 + 0.015.
        (now,) = spend_by_band((record,), rows, TODAY).groups
        self.assertEqual(now.banded_cost, D("0.765"))
        # 2027 row, marginal: 200,000 x 1.5 = 0.3; 100,000 x 3 = 0.3; 1,000 x 18 = 0.018.
        (later,) = spend_by_band((record,), rows, datetime.date(2027, 1, 1)).groups
        self.assertEqual(later.banded_cost, D("0.618"))
        self.assertEqual(later.row.effective_from, datetime.date(2027, 1, 1))
        # The day before the change, the 2026 row still applies.
        (eve,) = spend_by_band((record,), rows, datetime.date(2026, 12, 31)).groups
        self.assertEqual(eve.banded_cost, D("0.765"))

    def test_unpriced_ambiguous_and_not_yet_effective_are_listed(self):
        rows = (row("m", "p1"), row("m", "p2"),
                row("future", "p1", effective_from=datetime.date(2030, 1, 1)))
        records = (usage("nope", 1, 1), usage("m", 1, 1), usage("future", 1, 1),
                   usage("m", 1, 1, provider="p2"))
        report = spend_by_band(records, rows, TODAY)
        self.assertEqual([u.record.model for u in report.unpriced], ["nope", "m", "future"])
        self.assertTrue(all(u.reason for u in report.unpriced))
        (group,) = report.groups
        self.assertEqual(group.row.provider, "p2")

    def test_select_row_uses_the_named_provider(self):
        rows = (row("m", "p1"), row("m", "p2"))
        chosen = select_row(rows, usage("m", 1, 1, provider="p1"), TODAY)
        self.assertEqual(chosen.row.provider, "p1")
        self.assertIsNone(select_row(rows, usage("m", 1, 1, provider="p3"), TODAY).row)

    def test_groups_are_separate_per_row(self):
        rows = (row("a"), row("b"))
        report = spend_by_band((usage("a", 1, 1), usage("b", 1, 1), usage("a", 1, 1)), rows, TODAY)
        self.assertEqual([(g.row.model, g.requests) for g in report.groups], [("a", 2), ("b", 1)])


if __name__ == "__main__":
    unittest.main()
