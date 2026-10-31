"""Every shipped seed price must carry a source URL, an as-of date, and a tier.

The validator already requires all three (and applies_to on every banded row), so loading
data/prices.toml is most of the test. A missing or invalid file fails: it is not skipped.
"""

import datetime
import unittest
from pathlib import Path

from aicost.core import load_price_table, stale_warnings

SEED = Path(__file__).resolve().parents[1] / "data" / "prices.toml"
# The day every seed row was last checked against its provider's own page. Update this when
# the seed prices are re-checked.
CHECKED = datetime.date(2026, 10, 31)


class SeedData(unittest.TestCase):
    def test_seed_file_exists(self):
        self.assertTrue(SEED.is_file(), f"{SEED} is missing")

    def test_seed_prices_validate(self):
        rows = load_price_table(SEED)
        self.assertTrue(rows)

    def test_every_row_has_provenance(self):
        for row in load_price_table(SEED):
            with self.subTest(row=(row.provider, row.model, row.effective_from)):
                self.assertTrue(row.source_url.startswith("https://"))
                self.assertLessEqual(row.as_of, CHECKED)
                self.assertIn(row.tier, ("A", "B", "C"))
                self.assertGreater(row.shelf_life_days, 0)

    def test_nothing_is_stale_on_the_day_it_was_checked(self):
        self.assertEqual(stale_warnings(load_price_table(SEED, CHECKED), CHECKED), [])

    def test_every_banded_row_records_how_the_band_applies(self):
        for row in load_price_table(SEED):
            if row.threshold_tokens is not None:
                with self.subTest(row=(row.provider, row.model)):
                    self.assertIn(row.applies_to, ("whole_request", "marginal"))
                    self.assertIn(row.boundary, ("at_or_below", "under"))

    def test_the_january_1_2027_gemini_flash_change_is_recorded(self):
        rows = [r for r in load_price_table(SEED) if r.model == "gemini-3.8-flash"]
        self.assertEqual(sorted(r.effective_from for r in rows)[-1], datetime.date(2027, 1, 1))


if __name__ == "__main__":
    unittest.main()
