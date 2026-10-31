import datetime
import unittest
from decimal import Decimal
from pathlib import Path

from aicost.core import PriceTableError, load_price_table, parse_price_table, stale_warnings, tier_warnings

TODAY = datetime.date(2026, 10, 31)
FIXTURE = Path(__file__).parent / "fixtures" / "example_prices.toml"

ROW = """
[[price]]
provider = "p"
model = "m"
effective_from = 2026-01-01
input_per_mtok = 0.1
output_per_mtok = 0.2
source_url = "https://example.com/p"
as_of = 2026-10-31
tier = "A"
"""


class Loading(unittest.TestCase):
    def test_fixture_loads(self):
        rows = load_price_table(FIXTURE, TODAY)
        self.assertEqual(len(rows), 3)
        self.assertEqual(rows[1].effective_from, datetime.date(2027, 1, 1))
        self.assertEqual(rows[1].shelf_life_days, 14)
        self.assertEqual([r.applies_to for r in rows], ["whole_request", "marginal", None])

    def test_banded_toml_row_without_applies_to_is_rejected(self):
        band = (
            'threshold_tokens = 200000\nboundary = "under"\n'
            "input_per_mtok_above = 1\noutput_per_mtok_above = 2\n"
        )
        text = "schema_version = 1\n" + ROW + band
        with self.assertRaises(PriceTableError) as raised:
            parse_price_table(text, TODAY)
        self.assertTrue(any("applies_to" in p for p in raised.exception.problems))
        # The same row with applies_to added is valid.
        self.assertEqual(len(parse_price_table(text + 'applies_to = "marginal"\n', TODAY)), 1)

    def test_rates_are_exact_decimals(self):
        rows = load_price_table(FIXTURE, TODAY)
        self.assertEqual(rows[2].input_per_mtok, Decimal("0.1"))
        self.assertEqual(rows[0].input_per_mtok_above, Decimal("2.50"))
        self.assertEqual(rows[0].output_per_mtok, Decimal(10))

    def test_fixture_warnings(self):
        rows = load_price_table(FIXTURE, TODAY)
        self.assertEqual([w.model for w in tier_warnings(rows)], ["example-model-b"])
        # example-model-b was checked 2026-10-01, 30 days before TODAY: not stale.
        self.assertEqual(stale_warnings(rows, TODAY), [])
        later = TODAY + datetime.timedelta(days=15)
        self.assertEqual(
            sorted((w.model, w.effective_from.isoformat()) for w in stale_warnings(rows, later)),
            [
                ("example-model-a", "2027-01-01"),
                ("example-model-b", "2026-01-01"),
            ],
        )

    def test_today_defaults_to_the_clock(self):
        # as_of in the far future must fail whichever day this runs.
        text = 'schema_version = 1\n' + ROW.replace("2026-10-31", "2999-01-01")
        with self.assertRaises(PriceTableError):
            parse_price_table(text)


class Rejections(unittest.TestCase):
    def check(self, text, fragment):
        with self.assertRaises(PriceTableError) as raised:
            parse_price_table(text, TODAY)
        self.assertTrue(
            any(fragment in p for p in raised.exception.problems),
            raised.exception.problems,
        )

    def test_valid_minimal_table(self):
        self.assertEqual(len(parse_price_table("schema_version = 1\n" + ROW, TODAY)), 1)

    def test_invalid_toml(self):
        self.check("schema_version = [", "not valid TOML")

    def test_missing_schema_version(self):
        self.check(ROW, "schema_version must be 1")

    def test_wrong_schema_version(self):
        self.check("schema_version = 2\n" + ROW, "schema_version must be 1")

    def test_unknown_top_level_key(self):
        self.check("schema_version = 1\nprices = []\n" + ROW, "unknown top-level key 'prices'")

    def test_no_price_rows(self):
        self.check("schema_version = 1\n", "at least one")

    def test_row_problem_and_schema_problem_reported_together(self):
        with self.assertRaises(PriceTableError) as raised:
            parse_price_table(ROW.replace('tier = "A"', 'tier = "X"'), TODAY)
        self.assertEqual(len(raised.exception.problems), 2)

    def test_offset_datetime_is_not_a_date(self):
        text = "schema_version = 1\n" + ROW.replace("as_of = 2026-10-31", "as_of = 2026-10-31T12:00:00Z")
        self.check(text, "as_of must be a date")


if __name__ == "__main__":
    unittest.main()
