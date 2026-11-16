"""Every shipped seed price must carry a source URL, an as-of date, and a tier.

The validator already requires all three (and applies_to on every banded row), so loading
src/aicost/data/prices.toml is most of the test. A missing or invalid file fails: it is not skipped.
"""

import datetime
import tomllib
import unittest
from decimal import Decimal
from importlib.resources import files
from pathlib import Path

from aicost.bandcost import price_request
from aicost.core import load_price_table, stale_warnings, tier_warnings

SEED = Path(__file__).resolve().parents[1] / "src" / "aicost" / "data" / "prices.toml"
# The day every seed row was last re-read at its provider's own page (tag-day re-check,
# 2026-11-16). Update this when the seed prices are re-checked.
CHECKED = datetime.date(2026, 11, 16)


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

    def _row(self, provider, model, effective_from=None):
        rows = [r for r in load_price_table(SEED) if (r.provider, r.model) == (provider, model)]
        if effective_from is not None:
            rows = [r for r in rows if r.effective_from == effective_from]
        self.assertEqual(len(rows), 1, f"expected one row for {provider} {model} {effective_from}")
        return rows[0]

    def test_every_row_was_read_on_the_check_day(self):
        for row in load_price_table(SEED):
            with self.subTest(row=(row.provider, row.model, row.effective_from)):
                self.assertEqual(row.as_of, CHECKED)

    def test_google_rows_cite_the_current_pricing_urls(self):
        """Google's pricing page moved to aistudio.google.com and the Vertex page to
        cloud.google.com/model-garden/pricing; no row or note may point at the old addresses."""
        old = ("https://ai.google.dev/gemini-api/docs/pricing",
               "https://cloud.google.com/vertex-ai/generative-ai/pricing")  # fmt: skip
        google = [r for r in load_price_table(SEED) if r.provider == "google"]
        self.assertEqual(len(google), 10)
        for row in google:
            with self.subTest(row=(row.model, row.effective_from)):
                self.assertEqual(row.source_url, "https://aistudio.google.com/docs/pricing")
                for address in old:
                    self.assertNotIn(address, row.notes or "")
        text = SEED.read_text(encoding="utf-8")
        for address in old:
            self.assertNotIn(address, text)
        self.assertIn("https://cloud.google.com/model-garden/pricing", text)

    def test_gemini_2_5_pro_moves_to_flash_rates_on_2026_12_01(self):
        """Google's pages: from 2026-12-01 requests to gemini-2.5-pro route to gemini-3.8-flash
        and are billed at its rates (0.75 and 3.75 through 2026-12-31, then 1.50 and 7.50,
        single band). The 2027 step is inferred from Flash's own page.

        Hand computed at 300,000 in and 1,000 out (no band after the move):
        2026-12-01: 300000*0.75/1e6 + 1000*3.75/1e6 = 0.225 + 0.00375 = 0.22875.
        2027-01-01: 300000*1.5/1e6 + 1000*7.5/1e6 = 0.45 + 0.0075 = 0.4575.
        """
        rows = sorted(
            (r for r in load_price_table(SEED) if r.model == "gemini-2.5-pro"),
            key=lambda r: r.effective_from,
        )
        self.assertEqual(
            [r.effective_from for r in rows],
            [datetime.date(2026, 10, 31), datetime.date(2026, 12, 1), datetime.date(2027, 1, 1)],
        )
        current, december, january = rows
        self.assertEqual(current.threshold_tokens, 200_000)
        for row in (december, january):
            self.assertIsNone(row.threshold_tokens)
            self.assertIsNone(row.applies_to)
            self.assertEqual(row.as_of, CHECKED)
        self.assertEqual((december.input_per_mtok, december.output_per_mtok), (Decimal("0.75"), Decimal("3.75")))
        self.assertEqual((january.input_per_mtok, january.output_per_mtok), (Decimal("1.50"), Decimal("7.50")))
        self.assertEqual(price_request(december, 300_000, 1_000).total, Decimal("0.22875"))
        self.assertEqual(price_request(january, 300_000, 1_000).total, Decimal("0.4575"))
        self.assertIn("inferred", january.notes.lower())
        for row in (december, january):
            self.assertIn("gemini-3.8-flash", row.notes)

    def test_gemini_2_5_pro_step_matches_the_flash_rows(self):
        """The two new rows mirror the gemini-3.8-flash rows from the same dates."""
        flash = {r.effective_from: r for r in load_price_table(SEED) if r.model == "gemini-3.8-flash"}
        for day in (datetime.date(2026, 12, 1), datetime.date(2027, 1, 1)):
            pro = self._row("google", "gemini-2.5-pro", day)
            # Flash has no row on 2026-12-01; its 2026-10-31 row (0.75 and 3.75) is in force then.
            reference = flash.get(day) or flash[datetime.date(2026, 10, 31)]
            self.assertEqual((pro.input_per_mtok, pro.output_per_mtok),
                             (reference.input_per_mtok, reference.output_per_mtok))  # fmt: skip

    def test_gpt_5_6_sol_goes_stale_the_day_after_its_promotion_ends(self):
        """OpenAI's pages (read 2026-11-16): promotional pricing is available until
        2026-11-30 and no later price is stated. A 14-day shelf life from the 2026-11-16 check
        makes the row stale from 2026-12-01 and no earlier."""
        row = self._row("openai", "gpt-5.6-sol")
        self.assertEqual(row.shelf_life_days, 14)
        last_promo_day = datetime.date(2026, 11, 30)
        self.assertEqual(stale_warnings((row,), last_promo_day), [])
        self.assertEqual(len(stale_warnings((row,), last_promo_day + datetime.timedelta(days=1))), 1)
        self.assertIn("November 30, 2026", row.notes)
        # The earlier reading ("at least through November 21") may be quoted as history only.
        self.assertNotIn("is available at least through November 21", row.notes)

    def test_every_other_row_keeps_the_30_day_shelf_life(self):
        for row in load_price_table(SEED):
            if row.model != "gpt-5.6-sol":
                with self.subTest(row=(row.provider, row.model, row.effective_from)):
                    self.assertEqual(row.shelf_life_days, 30)

    def test_openai_rows_follow_the_pages_272k_whole_request_rule(self):
        models = (
            "gpt-6-astra", "gpt-6.1-sol", "gpt-6.1-terra", "gpt-6-luna", "gpt-5.6-sol",
            "gpt-5.6-terra", "gpt-5.6-luna", "gpt-5.5", "gpt-5.4",
        )  # fmt: skip
        for model in models:
            with self.subTest(model=model):
                row = self._row("openai", model)
                self.assertEqual(row.threshold_tokens, 272_000)
                self.assertEqual(row.boundary, "at_or_below")
                self.assertEqual(row.applies_to, "whole_request")
                # The model pages say 2x input and 1.5x output above the threshold.
                self.assertEqual(row.input_per_mtok_above, row.input_per_mtok * 2)
                self.assertEqual(row.output_per_mtok_above, row.output_per_mtok * Decimal("1.5"))
                self.assertIn("272", row.notes)

    def test_gpt_5_5_at_and_just_above_the_threshold(self):
        """Hand computed, input $5 and output $30 below, $10 and $45 above, per million.

        272,000 in and 1,000 out: 272000*5/1e6 + 1000*30/1e6 = 1.36 + 0.03 = 1.39.
        272,001 in and 1,000 out (whole request, upper rates): 272001*10/1e6 + 1000*45/1e6
        = 2.72001 + 0.045 = 2.76501.
        """
        row = self._row("openai", "gpt-5.5")
        self.assertEqual(price_request(row, 272_000, 1_000).total, Decimal("1.39"))
        self.assertEqual(price_request(row, 272_001, 1_000).total, Decimal("2.76501"))

    def test_gemini_pro_rows_at_and_just_above_200k(self):
        """Hand computed for gemini-3.1-pro-preview ($2 and $12 below, $4 and $18 above).

        200,000 in and 1,000 out: 200000*2/1e6 + 1000*12/1e6 = 0.4 + 0.012 = 0.412.
        200,001 in and 1,000 out: 200001*4/1e6 + 1000*18/1e6 = 0.800004 + 0.018 = 0.818004.
        gemini-2.5-pro ($1.25 and $10 below, $2.50 and $15 above), same token counts:
        0.25 + 0.01 = 0.26 and 200001*2.5/1e6 + 0.015 = 0.5000025 + 0.015 = 0.5150025.
        """
        pro31 = self._row("google", "gemini-3.1-pro-preview")
        pro25 = self._row("google", "gemini-2.5-pro", datetime.date(2026, 10, 31))
        for row in (pro31, pro25):
            self.assertEqual((row.threshold_tokens, row.boundary), (200_000, "at_or_below"))
            self.assertEqual(row.applies_to, "whole_request")
            self.assertIn("Vertex", row.notes)
        self.assertEqual(price_request(pro31, 200_000, 1_000).total, Decimal("0.412"))
        self.assertEqual(price_request(pro31, 200_001, 1_000).total, Decimal("0.818004"))
        self.assertEqual(price_request(pro25, 200_000, 1_000).total, Decimal("0.26"))
        self.assertEqual(price_request(pro25, 200_001, 1_000).total, Decimal("0.5150025"))

    def test_gemini_pro_rows_are_tier_b_and_raise_no_warning(self):
        """Tier B: the whole-request rule comes from the Vertex AI page, not the Gemini API page.
        Only tier C produces a warning, so these rows warn about nothing on the check day.
        The two banded rows are the ones that rest on the Vertex page; the later single-band
        gemini-2.5-pro rows are tested separately."""
        rows = [
            self._row("google", "gemini-3.1-pro-preview"),
            self._row("google", "gemini-2.5-pro", datetime.date(2026, 10, 31)),
        ]
        for row in rows:
            self.assertEqual(row.tier, "B")
        self.assertEqual(tier_warnings(tuple(rows)), [])
        self.assertEqual(stale_warnings(tuple(rows), CHECKED), [])

    def test_the_other_banded_and_flash_rows_stay_tier_a(self):
        for row in load_price_table(SEED):
            if row.model not in ("gemini-3.1-pro-preview", "gemini-2.5-pro"):
                with self.subTest(row=(row.provider, row.model, row.effective_from)):
                    self.assertEqual(row.tier, "A")

    def test_gemini_2_5_pro_step_tiers(self):
        """2026-12-01 is stated by Google's pages (tier A); the 2027 step is inferred from
        Flash's own page, so it is tier B."""
        self.assertEqual(self._row("google", "gemini-2.5-pro", datetime.date(2026, 12, 1)).tier, "A")
        self.assertEqual(self._row("google", "gemini-2.5-pro", datetime.date(2027, 1, 1)).tier, "B")

    def test_claude_opus_and_sonnet_rows_are_single_band(self):
        """Anthropic's page lists these at one rate each (dollars per million tokens):
        claude-opus-5 5 in and 25 out, claude-opus-5-5 4 and 20, claude-sonnet-5 2 and 10,
        claude-sonnet-5-5 2 and 10, with the full 1M context window at standard pricing.

        Hand computed for claude-opus-5-5 at 300,000 in and 1,000 out, no band change:
        300000*4/1e6 + 1000*20/1e6 = 1.2 + 0.02 = 1.22.
        """
        expected = {
            "claude-opus-5": (Decimal("5"), Decimal("25")),
            "claude-opus-5-5": (Decimal("4"), Decimal("20")),
            "claude-sonnet-5": (Decimal("2"), Decimal("10")),
            "claude-sonnet-5-5": (Decimal("2"), Decimal("10")),
        }
        for model, (input_rate, output_rate) in expected.items():
            with self.subTest(model=model):
                row = self._row("anthropic", model)
                self.assertEqual((row.input_per_mtok, row.output_per_mtok), (input_rate, output_rate))
                self.assertIsNone(row.threshold_tokens)
                self.assertEqual(row.as_of, CHECKED)
        opus = self._row("anthropic", "claude-opus-5-5")
        self.assertEqual(price_request(opus, 300_000, 1_000).total, Decimal("1.22"))
        # One band: 1,000,000 in and 1,000 out is 1000000*4/1e6 + 0.02 = 4.02 at the same rates.
        self.assertEqual(price_request(opus, 1_000_000, 1_000).total, Decimal("4.02"))

    def test_the_installed_package_finds_the_same_file(self):
        bundled = files("aicost").joinpath("data").joinpath("prices.toml")
        self.assertEqual(bundled.read_text(encoding="utf-8"), SEED.read_text(encoding="utf-8"))

    def test_pyproject_ships_the_seed_file_as_package_data(self):
        pyproject = tomllib.loads((SEED.parents[3] / "pyproject.toml").read_text(encoding="utf-8"))
        package_data = pyproject["tool"]["setuptools"]["package-data"]
        self.assertIn("data/*.toml", package_data["aicost"])


if __name__ == "__main__":
    unittest.main()
