import datetime
import tempfile
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

    def test_a_banded_row_can_be_followed_by_single_band_rows(self):
        """A scheduled change may drop the band rule (gemini-2.5-pro moves to Flash's single
        band on 2026-12-01). The loader accepts it and keeps all three rows in date order."""
        banded = (
            'threshold_tokens = 200000\nboundary = "at_or_below"\napplies_to = "whole_request"\n'
            "input_per_mtok_above = 2.5\noutput_per_mtok_above = 15\n"
        )
        later = ROW.replace("2026-01-01", "2026-12-01").replace("0.1", "0.75").replace("0.2", "3.75")
        latest = ROW.replace("2026-01-01", "2027-01-01").replace("0.1", "1.50").replace("0.2", "7.50")
        text = "schema_version = 1\n" + ROW + banded + later + latest
        rows = parse_price_table(text, TODAY)
        self.assertEqual([r.effective_from.isoformat() for r in rows], ["2026-01-01", "2026-12-01", "2027-01-01"])
        self.assertEqual([r.threshold_tokens for r in rows], [200000, None, None])
        self.assertEqual([r.input_per_mtok_above for r in rows], [Decimal("2.5"), None, None])
        self.assertEqual([r.input_per_mtok for r in rows], [Decimal("0.1"), Decimal("0.75"), Decimal("1.50")])

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

    def test_deeply_nested_toml_is_a_problem_not_a_crash(self):
        for text in ("x = " + "[" * 5000 + "]" * 5000, "x = " + "{a=" * 2000 + "1" + "}" * 2000):
            with self.subTest(text=text[:12]):
                self.check("schema_version = 1\n" + text + "\n" + ROW, "nested too deeply")

    def test_an_integer_with_thousands_of_digits_is_a_problem_not_a_crash(self):
        for key in ("shelf_life_days", "threshold_tokens"):
            with self.subTest(key=key):
                self.check("schema_version = 1\n" + ROW + f"{key} = " + "9" * 5000 + "\n", "could not be read")

    def test_an_exponent_too_large_to_read_is_a_problem_not_a_crash(self):
        # Review 5, finding 2: tomllib hands the text to Decimal, which raises InvalidOperation
        # (an ArithmeticError, not a ValueError) when the exponent is beyond its limits.
        for value in ("1e1000000000000000000000", "1e-1000000000000000000000", "0e1000000000000000000000"):
            for key, old in (("input_per_mtok", "0.1"), ("output_per_mtok", "0.2")):
                with self.subTest(value=value, key=key):
                    text = "schema_version = 1\n" + ROW.replace(f"{key} = {old}", f"{key} = {value}")
                    self.check(text, "a value could not be read")

    def test_a_large_but_legal_exponent_is_still_a_rate_problem(self):
        text = "schema_version = 1\n" + ROW.replace("input_per_mtok = 0.1", "input_per_mtok = 1e999999999999999999")
        self.check(text, "input_per_mtok must be at most 1,000,000 dollars per million tokens")

    def test_a_key_name_is_escaped_in_the_problem_text(self):
        text = 'schema_version = 1\n"bad\\u001b[2Jk\\u00e9y" = 1\n' + ROW
        with self.assertRaises(PriceTableError) as raised:
            parse_price_table(text, TODAY)
        (problem,) = raised.exception.problems
        self.assertEqual(problem, "unknown top-level key 'bad\\x1b[2Jk\\xe9y'")


class ReadingFiles(unittest.TestCase):
    def write(self, data):
        folder = tempfile.TemporaryDirectory()
        self.addCleanup(folder.cleanup)
        path = Path(folder.name) / "prices.toml"
        path.write_bytes(data)
        return path

    def test_a_byte_order_mark_is_accepted(self):
        path = self.write(b"\xef\xbb\xbf" + ("schema_version = 1\n" + ROW).encode("utf-8"))
        self.assertEqual(len(load_price_table(path, TODAY)), 1)

    def test_a_file_that_is_not_utf8_is_a_price_table_error(self):
        path = self.write(b"schema_version = 1\n# caf\xe9\n")
        with self.assertRaises(PriceTableError) as raised:
            load_price_table(path, TODAY)
        (problem,) = raised.exception.problems
        self.assertEqual(problem, "not valid UTF-8 (at byte 24): invalid continuation byte")

    def test_utf16_is_not_utf8(self):
        path = self.write(("schema_version = 1\n" + ROW).encode("utf-16"))
        with self.assertRaises(PriceTableError):
            load_price_table(path, TODAY)


if __name__ == "__main__":
    unittest.main()
