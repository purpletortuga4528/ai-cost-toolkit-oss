import datetime
import unittest
from decimal import Decimal

from aicost.core import PriceTableError, parse_price_table, tier_warnings
from aicost.core.schema import validate_rows

TODAY = datetime.date(2026, 10, 31)


def good_row(**changes):
    row = {
        "provider": "example-provider",
        "model": "example-model",
        "effective_from": datetime.date(2026, 1, 1),
        "input_per_mtok": Decimal("1.25"),
        "output_per_mtok": Decimal("10"),
        "source_url": "https://example.com/pricing",
        "as_of": datetime.date(2026, 10, 31),
        "tier": "A",
    }
    row.update(changes)
    return row


def banded_row(**changes):
    band = {
        "threshold_tokens": 200000,
        "boundary": "at_or_below",
        "applies_to": "whole_request",
        "input_per_mtok_above": Decimal("2.5"),
        "output_per_mtok_above": Decimal("15"),
    }
    band.update(changes)
    return good_row(**band)


def problems_for(*rows):
    with_error = None
    try:
        validate_rows(list(rows), TODAY)
    except PriceTableError as error:
        with_error = error
    return with_error.problems if with_error else []


class ValidRows(unittest.TestCase):
    def test_single_band_row(self):
        (row,) = validate_rows([good_row()], TODAY)
        self.assertIsNone(row.threshold_tokens)
        self.assertIsNone(row.boundary)
        self.assertIsNone(row.applies_to)
        self.assertIsNone(row.input_per_mtok_above)
        self.assertEqual(row.shelf_life_days, 30)
        self.assertEqual(row.notes, "")

    def test_banded_row(self):
        (row,) = validate_rows([banded_row()], TODAY)
        self.assertEqual(row.threshold_tokens, 200000)
        self.assertEqual(row.boundary, "at_or_below")
        self.assertEqual(row.applies_to, "whole_request")
        self.assertEqual(row.input_per_mtok_above, Decimal("2.5"))

    def test_both_boundary_rules_accepted(self):
        for rule in ("at_or_below", "under"):
            with self.subTest(rule=rule):
                (row,) = validate_rows([banded_row(boundary=rule)], TODAY)
                self.assertEqual(row.boundary, rule)

    def test_both_applies_to_values_accepted(self):
        for value in ("whole_request", "marginal"):
            with self.subTest(applies_to=value):
                (row,) = validate_rows([banded_row(applies_to=value)], TODAY)
                self.assertEqual(row.applies_to, value)

    def test_integer_rate_becomes_decimal(self):
        (row,) = validate_rows([good_row(output_per_mtok=10)], TODAY)
        self.assertEqual(row.output_per_mtok, Decimal(10))
        self.assertIsInstance(row.output_per_mtok, Decimal)

    def test_as_of_today_is_allowed(self):
        validate_rows([good_row(as_of=TODAY)], TODAY)

    def test_same_model_on_different_dates_is_allowed(self):
        validate_rows(
            [good_row(), good_row(effective_from=datetime.date(2027, 1, 1))], TODAY
        )


class RequiredFields(unittest.TestCase):
    def test_each_required_key_missing_is_reported(self):
        for key in good_row():
            with self.subTest(key=key):
                row = good_row()
                del row[key]
                self.assertTrue(
                    any(f"missing required key '{key}'" in p for p in problems_for(row))
                )

    def test_empty_table_is_rejected(self):
        with self.assertRaises(PriceTableError):
            validate_rows([], TODAY)


class FieldRules(unittest.TestCase):
    def test_tier_x_is_rejected_as_not_shipped(self):
        self.assertTrue(any("not shipped" in p for p in problems_for(good_row(tier="X"))))

    def test_other_tiers_are_rejected(self):
        for tier in ("D", "a", "", None, 1):
            with self.subTest(tier=tier):
                self.assertTrue(problems_for(good_row(tier=tier)))

    def test_source_url_must_be_http_or_https(self):
        for url in ("example.com/pricing", "ftp://example.com/p", "https://", "", 5):
            with self.subTest(url=url):
                self.assertTrue(problems_for(good_row(source_url=url)))

    def test_future_as_of_is_rejected(self):
        self.assertTrue(
            any("future" in p for p in problems_for(good_row(as_of=datetime.date(2026, 11, 1))))
        )

    def test_datetime_is_not_a_date(self):
        stamp = datetime.datetime(2026, 10, 31, 12, 0)
        self.assertTrue(problems_for(good_row(as_of=stamp)))
        self.assertTrue(problems_for(good_row(effective_from=stamp)))

    def test_rates_must_be_nonnegative_finite_exact_numbers(self):
        for bad in (Decimal("-0.01"), Decimal("NaN"), Decimal("Infinity"), 1.25, "1.25", True):
            with self.subTest(rate=bad):
                self.assertTrue(problems_for(good_row(input_per_mtok=bad)))

    def test_zero_rate_is_allowed(self):
        validate_rows([good_row(input_per_mtok=Decimal(0))], TODAY)

    def test_shelf_life_must_be_positive_integer(self):
        for bad in (0, -1, 1.5, "30", True):
            with self.subTest(value=bad):
                self.assertTrue(problems_for(good_row(shelf_life_days=bad)))

    def test_unknown_key_is_rejected(self):
        self.assertTrue(any("unknown key" in p for p in problems_for(good_row(sorce_url="x"))))

    def test_blank_provider_or_model_is_rejected(self):
        self.assertTrue(problems_for(good_row(provider="  ")))
        self.assertTrue(problems_for(good_row(model="")))

    def test_row_must_be_a_table(self):
        self.assertTrue(problems_for("not a table"))


class BandRules(unittest.TestCase):
    def test_band_keys_go_together(self):
        keys = (
            "threshold_tokens",
            "boundary",
            "applies_to",
            "input_per_mtok_above",
            "output_per_mtok_above",
        )
        for key in keys:
            with self.subTest(missing=key):
                row = banded_row()
                del row[key]
                self.assertTrue(any("go together" in p for p in problems_for(row)))

    def test_above_rates_without_threshold_are_rejected(self):
        row = good_row(input_per_mtok_above=Decimal(2), output_per_mtok_above=Decimal(3))
        self.assertTrue(any("go together" in p for p in problems_for(row)))

    def test_applies_to_has_no_default_on_a_banded_row(self):
        row = banded_row()
        del row["applies_to"]
        found = problems_for(row)
        self.assertTrue(any("applies_to" in p and "missing" in p for p in found), found)

    def test_applies_to_alone_on_a_single_band_row_is_rejected(self):
        found = problems_for(good_row(applies_to="whole_request"))
        self.assertTrue(any("go together" in p and "applies_to" in p for p in found), found)

    def test_bad_applies_to_is_rejected(self):
        for bad in ("whole", "Marginal", "WHOLE_REQUEST", "", None, 1):
            with self.subTest(applies_to=bad):
                found = problems_for(banded_row(applies_to=bad))
                self.assertTrue(any("applies_to must be one of" in p for p in found), found)

    def test_bad_boundary_is_rejected(self):
        for bad in ("at", "over", "AT_OR_BELOW", None):
            with self.subTest(boundary=bad):
                self.assertTrue(problems_for(banded_row(boundary=bad)))

    def test_threshold_must_be_positive_integer(self):
        for bad in (0, -5, 200000.0, "200000", True):
            with self.subTest(threshold=bad):
                self.assertTrue(problems_for(banded_row(threshold_tokens=bad)))


class WholeTable(unittest.TestCase):
    def test_duplicate_provider_model_and_date_is_rejected(self):
        self.assertTrue(any("duplicates row 1" in p for p in problems_for(good_row(), good_row())))

    def test_all_problems_are_reported_together(self):
        found = problems_for(good_row(tier="X"), good_row(model="m2", source_url="nope"))
        self.assertEqual(len(found), 2)


class TierWarnings(unittest.TestCase):
    def test_tier_c_warns_and_others_do_not(self):
        rows = validate_rows(
            [good_row(tier="A"), good_row(model="b", tier="B"), good_row(model="c", tier="C")],
            TODAY,
        )
        warned = tier_warnings(rows)
        self.assertEqual([w.model for w in warned], ["c"])
        self.assertEqual(warned[0].kind, "tier_c")


if __name__ == "__main__":
    unittest.main()
