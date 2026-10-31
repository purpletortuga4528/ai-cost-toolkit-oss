import datetime
import unittest
from decimal import Decimal

from aicost.core import stale_warnings
from aicost.core.schema import validate_rows

TODAY = datetime.date(2026, 10, 31)


def rows_with(**changes):
    raw = {
        "provider": "example-provider",
        "model": "example-model",
        "effective_from": datetime.date(2026, 1, 1),
        "input_per_mtok": Decimal(1),
        "output_per_mtok": Decimal(2),
        "source_url": "https://example.com/pricing",
        "as_of": datetime.date(2026, 10, 31),
        "tier": "A",
    }
    raw.update(changes)
    return validate_rows([raw], TODAY)


class StaleRule(unittest.TestCase):
    def test_fresh_row_has_no_warning(self):
        self.assertEqual(stale_warnings(rows_with(), TODAY), [])

    def test_exactly_at_default_shelf_life_is_not_stale(self):
        as_of = TODAY - datetime.timedelta(days=30)
        self.assertEqual(stale_warnings(rows_with(as_of=as_of), TODAY), [])

    def test_one_day_past_default_shelf_life_is_stale(self):
        as_of = TODAY - datetime.timedelta(days=31)
        (warning,) = stale_warnings(rows_with(as_of=as_of), TODAY)
        self.assertEqual(warning.kind, "stale")
        self.assertIn("31 days old", warning.message)
        self.assertIn("https://example.com/pricing", warning.message)

    def test_row_shelf_life_overrides_default(self):
        as_of = TODAY - datetime.timedelta(days=15)
        self.assertEqual(stale_warnings(rows_with(as_of=as_of), TODAY), [])
        self.assertEqual(len(stale_warnings(rows_with(as_of=as_of, shelf_life_days=14), TODAY)), 1)
        at_limit = TODAY - datetime.timedelta(days=14)
        self.assertEqual(stale_warnings(rows_with(as_of=at_limit, shelf_life_days=14), TODAY), [])

    def test_result_depends_on_the_date_passed_in(self):
        rows = rows_with()
        self.assertEqual(stale_warnings(rows, TODAY + datetime.timedelta(days=30)), [])
        self.assertEqual(len(stale_warnings(rows, TODAY + datetime.timedelta(days=31))), 1)

    def test_only_stale_rows_are_reported(self):
        old = datetime.date(2026, 1, 1)
        rows = validate_rows(
            [
                {
                    "provider": "p", "model": "old", "effective_from": old,
                    "input_per_mtok": Decimal(1), "output_per_mtok": Decimal(1),
                    "source_url": "https://example.com/a", "as_of": old, "tier": "A",
                },
                {
                    "provider": "p", "model": "new", "effective_from": old,
                    "input_per_mtok": Decimal(1), "output_per_mtok": Decimal(1),
                    "source_url": "https://example.com/b", "as_of": TODAY, "tier": "A",
                },
            ],
            TODAY,
        )
        self.assertEqual([w.model for w in stale_warnings(rows, TODAY)], ["old"])


if __name__ == "__main__":
    unittest.main()
