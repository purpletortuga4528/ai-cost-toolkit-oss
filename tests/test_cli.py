"""Each command run end to end on synthetic fixtures, with hand-computed expected values.

Fixtures: tests/fixtures/cli_prices.toml and cli_usage.csv (the same seven requests are in
cli_usage.jsonl). All money below is worked out by hand, in dollars. "Today" is fixed with
--today so nothing depends on the clock.

model-a (whole request, 200,000 at or below; lower 1 in / 2 out, upper 3 in / 6 out):
  r1 100,000 in, 10,000 out: 0.1 + 0.02 = 0.12
  r2 200,000 in, 0 out (exactly at the threshold, lower band): 0.2
  r3 300,000 in, 10,000 out (upper): 0.9 + 0.06 = 0.96
  with bands 1.28; headline 0.12 + 0.2 + 0.32 = 0.64; gap 0.64; share above 0.96 / 1.28 = 75%.
model-b (single band; 0.5 in / 1.5 out): r4 1,000,000 in, 100,000 out: 0.5 + 0.15 = 0.65.
model-c (under 100,000, marginal; lower 2 in / 8 out, upper 4 in / 16 out):
  r5 100,000 in, 5,000 out: at the threshold under "under", so 1 token is upper:
     99,999 x 2 + 1 x 4 = 199,998 + 4 = 200,002 per million -> 0.200002; output 5,000 x 16 = 0.08;
     total 0.280002; headline 0.2 + 0.04 = 0.24
  r6 150,000 in, 5,000 out: 50,001 upper: 99,999 x 2 + 50,001 x 4 = 199,998 + 200,004 = 400,002
     per million -> 0.400002; output 0.08; total 0.480002; headline 0.3 + 0.04 = 0.34
  with bands 0.760004; headline 0.58; gap 0.180004; both requests upper, so share above 100%;
  upper-rate input tokens 1 + 50,001 = 50,002; upper-rate cost 0.080004 + 0.280004 = 0.360008.
Totals: with bands 1.28 + 0.65 + 0.760004 = 2.690004; headline 0.64 + 0.65 + 0.58 = 1.87;
  gap 0.820004. r7 (mystery-model) has no price row.
On 2027-01-01 model-a's rates are 1.5 times higher: with bands 1.92. Total 2.690004 - 1.28 + 1.92
  = 3.330004; change 0.64 (0.64 / 2.690004 = 23.79 percent).
"""

import contextlib
import io
import re
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

from aicost.cli import main

FIXTURES = Path(__file__).parent / "fixtures"
PRICES = FIXTURES / "cli_prices.toml"
CSV = FIXTURES / "cli_usage.csv"
JSONL = FIXTURES / "cli_usage.jsonl"
SEED_PRICES = Path(__file__).resolve().parents[1] / "src" / "aicost" / "data" / "prices.toml"
SEED_USAGE = FIXTURES / "seed_usage.csv"
TODAY = "2026-10-31"
SEED_TODAY = "2026-11-01"  # the seed table holds rows read on 2026-11-01


def run(*argv):
    """Run main(argv); return (exit code, stdout, stderr). argparse errors give exit code 2."""
    out, err = io.StringIO(), io.StringIO()
    with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
        try:
            code = main([str(a) for a in argv])
        except SystemExit as exit_:
            code = exit_.code
    return code, out.getvalue(), err.getvalue()


def block(text, title):
    """The lines from the one starting with `title` up to the next blank line."""
    lines = text.splitlines()
    start = next(i for i, line in enumerate(lines) if line.startswith(title))
    end = start
    while end < len(lines) and lines[end].strip():
        end += 1
    return lines[start:end]


def write(directory, name, text):
    path = Path(directory) / name
    path.write_text(text, encoding="utf-8")
    return path


class Report(unittest.TestCase):
    def setUp(self):
        self.code, self.out, self.err = run("report", CSV, "--prices", PRICES, "--today", TODAY)

    def test_runs_cleanly(self):
        self.assertEqual((self.code, self.err), (0, ""))
        self.assertIn("Requests: 7 read, 6 priced, 1 unpriced", self.out)

    def test_whole_request_model_with_a_request_exactly_at_the_threshold(self):
        self.assertEqual(
            block(self.out, "example-provider / model-a")[1:],
            [
                "  band: threshold 200,000 input tokens; a request at exactly the threshold stays in "
                "the lower band; the upper band prices the whole request",
                "  rates, $ per 1M tokens: input $1.00 / $3.00, output $2.00 / $6.00 (lower / upper band)",
                "  requests: 3, of which 1 above the threshold",
                "  tokens: 600,000 input, 20,000 output",
                "  cost with bands:       $1.2800",
                "  cost at headline rate: $0.6400",
                "  gap:                   $0.6400",
                "  share of spend above the threshold: 75.0%",
            ],
        )

    def test_single_band_model_has_no_share(self):
        lines = block(self.out, "example-provider / model-b")
        self.assertIn("  band: single band, no threshold", lines)
        self.assertIn("  cost with bands:       $0.6500", lines)
        self.assertIn("  gap:                   $0.0000", lines)
        self.assertIn("  share of spend above the threshold: n/a (single band)", lines)

    def test_marginal_under_model_at_the_boundary(self):
        lines = block(self.out, "other-provider / model-c")
        self.assertIn("  requests: 2, of which 2 above the threshold", lines)
        self.assertIn("  tokens: 250,000 input, 10,000 output", lines)
        self.assertIn("  cost with bands:       $0.7600", lines)
        self.assertIn("  cost at headline rate: $0.5800", lines)
        self.assertIn("  gap:                   $0.1800", lines)
        self.assertIn("  share of spend above the threshold: 100.0%", lines)
        self.assertIn(
            "  input tokens priced at the upper rate: 50,002; "
            "cost at upper-band rates (those tokens plus output): $0.3600",
            lines,
        )

    def test_totals(self):
        lines = block(self.out, "TOTAL")
        self.assertIn("  cost with bands:       $2.6900", lines)
        self.assertIn("  cost at headline rate: $1.8700", lines)
        self.assertIn("  gap:                   $0.8200", lines)

    def test_unpriced_request_is_listed_not_dropped(self):
        self.assertIn(
            "  mystery-model: 1 request, no price row for this model (first at line 8)",
            block(self.out, "UNPRICED"),
        )

    def test_stale_and_tier_c_warnings_surface(self):
        warnings = block(self.out, "WARNINGS")
        stale = [line for line in warnings if "[stale]" in line]
        tier_c = [line for line in warnings if "[tier_c]" in line]
        self.assertEqual(len(stale), 1)
        self.assertIn(
            "example-provider / model-b (row effective 2026-01-01) [stale] "
            "price checked 2026-08-01 is 91 days old; shelf life is 30 days",
            stale[0],
        )
        self.assertEqual(len(tier_c), 1)
        self.assertIn("example-provider / model-b", tier_c[0])

    def test_every_row_stale_when_today_is_later(self):
        # On 2027-02-01 every fixture row (checked 2026-10-31 or earlier) is past 30 days.
        code, out, _ = run("report", CSV, "--prices", PRICES, "--today", "2027-02-01")
        self.assertEqual(code, 0)
        warnings = block(out, "WARNINGS")
        # model-a has two rows, model-b one, model-c one.
        self.assertEqual(len([line for line in warnings if "[stale]" in line]), 4)
        # Priced on 2027-02-01, model-a uses its 2027-01-01 row: 1.5 times the earlier total.
        self.assertIn("  cost with bands:       $1.9200", block(out, "example-provider / model-a"))
        self.assertIn("(price row effective 2027-01-01", block(out, "example-provider / model-a")[0])

    def test_jsonl_gives_the_same_report_as_csv(self):
        _, out_jsonl, _ = run("report", JSONL, "--prices", PRICES, "--today", TODAY)
        # Line numbers differ by one: the CSV has a header row, the JSON Lines file has none.
        self.assertIn(
            "  mystery-model: 1 request, no price row for this model (first at line 8)", self.out.splitlines()
        )
        self.assertIn(
            "  mystery-model: 1 request, no price row for this model (first at line 7)", out_jsonl.splitlines()
        )

        def without_file_and_lines(text):
            return [line for line in text.splitlines()[1:] if "(first at line " not in line]

        self.assertEqual(without_file_and_lines(self.out), without_file_and_lines(out_jsonl))

    def test_format_flag_overrides_the_suffix(self):
        with tempfile.TemporaryDirectory() as directory:
            odd = write(directory, "usage.txt", CSV.read_text(encoding="utf-8"))
            self.assertEqual(run("report", odd, "--prices", PRICES, "--today", TODAY)[0], 1)
            code, out, _ = run("report", odd, "--format", "csv", "--prices", PRICES, "--today", TODAY)
        self.assertEqual(code, 0)
        self.assertIn("  cost with bands:       $2.6900", block(out, "TOTAL"))


class Schedule(unittest.TestCase):
    def test_lists_the_scheduled_change_with_its_date(self):
        code, out, err = run("schedule", CSV, "--prices", PRICES, "--today", TODAY)
        self.assertEqual((code, err), (0, ""))
        # Oct 31 to Jan 1 is 30 + 31 + 1 = 62 days.
        self.assertEqual(
            block(out, "2027-01-01")[0], "2027-01-01  example-provider / model-a  (in 62 days)"
        )
        self.assertEqual(
            block(out, "2027-01-01")[1:],
            [
                "  before (row effective 2026-01-01): input $1.00 / $3.00, output $2.00 / $6.00 (lower / upper band)",
                "  after:  input $1.50 / $4.50, output $3.00 / $9.00 (lower / upper band)",
                "  change in lower-band rates: input +50.0%, output +50.0%",
                "  your usage for this model: 3 requests, 600,000 input tokens, 20,000 output tokens",
                "  source: https://example.com/pricing-a (checked 2026-10-31, tier A)",
            ],
        )
        # Only model-a has a later row.
        self.assertEqual(len(re.findall(r"^\d{4}-\d\d-\d\d  ", out, re.MULTILINE)), 1)

    def test_warnings_surface(self):
        _, out, _ = run("schedule", CSV, "--prices", PRICES, "--today", TODAY)
        warnings = block(out, "WARNINGS")
        self.assertEqual(len([line for line in warnings if "[stale]" in line]), 1)
        self.assertEqual(len([line for line in warnings if "[tier_c]" in line]), 1)

    def test_none_once_the_change_has_taken_effect(self):
        code, out, _ = run("schedule", CSV, "--prices", PRICES, "--today", "2027-01-01")
        self.assertEqual(code, 0)
        self.assertIn(
            "  none: no row in the price table takes effect after today for these models.",
            block(out, "SCHEDULED"),
        )

    def test_a_provider_column_limits_the_match_to_that_provider(self):
        def price(provider):
            return (
                f'[[price]]\nprovider = "{provider}"\nmodel = "m"\neffective_from = 2027-01-01\n'
                "input_per_mtok = 1\noutput_per_mtok = 2\n"
                'source_url = "https://example.com/p"\nas_of = 2026-10-31\ntier = "A"\n'
            )

        with tempfile.TemporaryDirectory() as directory:
            prices = write(directory, "p.toml", "schema_version = 1\n" + price("p1") + price("p2"))
            named = write(directory, "named.csv", "provider,model,input_tokens,output_tokens\np1,m,1,1\n")
            bare = write(directory, "bare.csv", "model,input_tokens,output_tokens\nm,1,1\n")
            _, out_named, _ = run("schedule", named, "--prices", prices, "--today", TODAY)
            _, out_bare, _ = run("schedule", bare, "--prices", prices, "--today", TODAY)
        self.assertIn("2027-01-01  p1 / m", out_named)
        self.assertNotIn("p2 / m", out_named)
        # Without a provider column the model name matches both providers' rows.
        self.assertIn("2027-01-01  p1 / m", out_bare)
        self.assertIn("2027-01-01  p2 / m", out_bare)

    def test_ignores_models_not_in_the_export(self):
        with tempfile.TemporaryDirectory() as directory:
            usage = write(directory, "u.csv", "model,input_tokens,output_tokens\nmodel-b,10,10\n")
            _, out, _ = run("schedule", usage, "--prices", PRICES, "--today", TODAY)
        self.assertIn("none", block(out, "SCHEDULED")[1])


class Reprice(unittest.TestCase):
    def setUp(self):
        self.code, self.out, self.err = run(
            "reprice", CSV, "--prices", PRICES, "--today", TODAY, "--on", "2027-01-01"
        )

    def test_runs_cleanly(self):
        self.assertEqual((self.code, self.err), (0, ""))

    def test_by_model(self):
        lines = block(self.out, "COST BY MODEL")
        self.assertIn(
            "  example-provider / model-a: now $1.2800, then $1.9200, change +$0.6400 (+50.0%)", lines
        )
        self.assertIn(
            "  example-provider / model-b: now $0.6500, then $0.6500, change +$0.0000 (+0.0%)", lines
        )
        self.assertIn(
            "  other-provider / model-c: now $0.7600, then $0.7600, change +$0.0000 (+0.0%)", lines
        )

    def test_total(self):
        self.assertEqual(
            block(self.out, "TOTAL"),
            [
                "TOTAL (priced requests only)",
                "  now:    $2.6900",
                "  then:   $3.3300",
                "  change: +$0.6400 (+23.8%)",
            ],
        )

    def test_unpriced_request_listed_for_both_dates(self):
        line = "  mystery-model: 1 request, no price row for this model (first at line 8)"
        self.assertIn(line, block(self.out, "UNPRICED ON 2026-10-31"))
        self.assertIn(line, block(self.out, "UNPRICED ON 2027-01-01"))
        self.assertNotIn("priced on only one", self.out)

    def test_warnings_surface(self):
        warnings = block(self.out, "WARNINGS")
        self.assertEqual(len([line for line in warnings if "[stale]" in line]), 1)
        self.assertEqual(len([line for line in warnings if "[tier_c]" in line]), 1)

    def test_a_model_priced_on_only_one_date_is_flagged(self):
        prices = (
            "schema_version = 1\n"
            "[[price]]\n"
            'provider = "p"\nmodel = "m"\neffective_from = 2027-01-01\n'
            "input_per_mtok = 1\noutput_per_mtok = 2\n"
            'source_url = "https://example.com/p"\nas_of = 2026-10-31\ntier = "A"\n'
        )
        with tempfile.TemporaryDirectory() as directory:
            prices_file = write(directory, "p.toml", prices)
            usage = write(directory, "u.csv", "model,input_tokens,output_tokens\nm,1000000,1000000\n")
            code, out, _ = run("reprice", usage, "--prices", prices_file, "--today", TODAY, "--on", "2027-01-01")
        self.assertEqual(code, 0)
        self.assertIn("  p / m: not priced now; no comparison", out)
        self.assertIn("WARNING: some requests are priced on only one of the two dates", out)
        self.assertIn(
            "  m: 1 request, every price row for this model takes effect after the pricing date (first at line 2)",
            block(out, "UNPRICED ON 2026-10-31"),
        )
        # 1,000,000 x 1 + 1,000,000 x 2 = $3.00 on the later date.
        self.assertIn("  then:   $3.0000", out)


class BadInput(unittest.TestCase):
    def test_missing_price_file(self):
        code, out, err = run("report", CSV, "--prices", FIXTURES / "nope.toml", "--today", TODAY)
        self.assertEqual((code, out), (1, ""))
        self.assertIn("nope.toml", err)
        self.assertIn("cannot use", err)

    def test_invalid_price_table_lists_the_problem(self):
        with tempfile.TemporaryDirectory() as directory:
            bad = write(directory, "p.toml", "schema_version = 2\n")
            code, out, err = run("report", CSV, "--prices", bad, "--today", TODAY)
        self.assertEqual((code, out), (1, ""))
        self.assertIn("schema_version must be 1", err)

    def test_missing_usage_file(self):
        code, out, err = run("report", FIXTURES / "nope.csv", "--prices", PRICES, "--today", TODAY)
        self.assertEqual((code, out), (1, ""))
        self.assertIn("nope.csv", err)

    def test_invalid_usage_lists_the_problem(self):
        with tempfile.TemporaryDirectory() as directory:
            bad = write(directory, "u.csv", "model,input_tokens\nm,1\n")
            code, out, err = run("report", bad, "--prices", PRICES, "--today", TODAY)
        self.assertEqual((code, out), (1, ""))
        self.assertIn("missing required column 'output_tokens'", err)

    def test_unknown_usage_suffix(self):
        with tempfile.TemporaryDirectory() as directory:
            odd = write(directory, "u.txt", "x")
            code, _, err = run("report", odd, "--prices", PRICES, "--today", TODAY)
        self.assertEqual(code, 1)
        self.assertIn("cannot tell the format", err)

    def test_command_line_mistakes_exit_2(self):
        self.assertEqual(run()[0], 2)  # no command
        self.assertEqual(run("report", CSV, "--today", "2026-13-01")[0], 2)  # not a date
        self.assertEqual(run("reprice", CSV, "--prices", PRICES)[0], 2)  # --on is required
        self.assertEqual(run("report")[0], 2)  # no usage file

    def test_a_price_checked_after_today_is_rejected(self):
        # The fixture rows say they were checked on 2026-10-31, so 2026-10-30 is "before".
        code, _, err = run("report", CSV, "--prices", PRICES, "--today", "2026-10-30")
        self.assertEqual(code, 1)
        self.assertIn("is in the future", err)


class UnpricedGrouping(unittest.TestCase):
    """Unpriced requests are listed once per provider, model, and reason, with a count.

    Each test builds a small CSV (header on line 1) and counts the requests by hand in a comment.
    """

    PRICES = (
        "schema_version = 1\n"
        "[[price]]\n"
        'provider = "p1"\nmodel = "dup"\neffective_from = 2026-10-31\n'
        "input_per_mtok = 1\noutput_per_mtok = 2\n"
        'source_url = "https://example.com/p"\nas_of = 2026-10-31\ntier = "A"\n'
        "[[price]]\n"
        'provider = "p2"\nmodel = "dup"\neffective_from = 2026-10-31\n'
        "input_per_mtok = 1\noutput_per_mtok = 2\n"
        'source_url = "https://example.com/p"\nas_of = 2026-10-31\ntier = "A"\n'
    )

    def run_usage(self, usage_text, command="report", *extra):
        with tempfile.TemporaryDirectory() as directory:
            prices = write(directory, "p.toml", self.PRICES)
            usage = write(directory, "u.csv", usage_text)
            return run(command, usage, "--prices", prices, "--today", TODAY, *extra)

    def test_counts_order_and_first_line(self):
        # Lines 2, 4, 5 are "ghost" (3 requests); line 3 is "spook" (1); the order is by
        # count, highest first.
        usage = "model,input_tokens,output_tokens\nghost,1,1\nspook,1,1\nghost,1,1\nghost,1,1\n"
        code, out, _ = self.run_usage(usage)
        self.assertEqual(code, 0)
        self.assertEqual(
            block(out, "UNPRICED"),
            [
                "UNPRICED REQUESTS (not in any total)",
                "  ghost: 3 requests, no price row for this model (first at line 2)",
                "  spook: 1 request, no price row for this model (first at line 3)",
            ],
        )
        self.assertIn("Requests: 4 read, 0 priced, 4 unpriced", out)

    def test_same_model_under_two_providers_is_two_lines(self):
        usage = "provider,model,input_tokens,output_tokens\na,ghost,1,1\nb,ghost,1,1\na,ghost,1,1\n"
        _, out, _ = self.run_usage(usage)
        self.assertEqual(
            block(out, "UNPRICED")[1:],
            [
                "  a / ghost: 2 requests, no price row for this model (first at line 2)",
                "  b / ghost: 1 request, no price row for this model (first at line 3)",
            ],
        )

    def test_a_different_reason_is_a_separate_line(self):
        # "dup" is under p1 and p2, so a record without a provider is ambiguous, while
        # "ghost" has no price row at all.
        usage = "model,input_tokens,output_tokens\ndup,1,1\nghost,1,1\ndup,1,1\n"
        _, out, _ = self.run_usage(usage)
        lines = block(out, "UNPRICED")[1:]
        self.assertEqual(len(lines), 2)
        self.assertTrue(lines[0].startswith("  dup: 2 requests, model appears under more than one provider"))
        self.assertTrue(lines[0].endswith("(first at line 2)"))
        self.assertEqual(lines[1], "  ghost: 1 request, no price row for this model (first at line 3)")

    def test_a_thousand_requests_print_one_line(self):
        usage = "model,input_tokens,output_tokens\n" + "ghost,1,1\n" * 1000
        _, out, _ = self.run_usage(usage)
        self.assertEqual(
            block(out, "UNPRICED"),
            [
                "UNPRICED REQUESTS (not in any total)",
                "  ghost: 1,000 requests, no price row for this model (first at line 2)",
            ],
        )
        self.assertNotIn("line 3", out)

    def test_reprice_groups_for_both_dates(self):
        usage = "model,input_tokens,output_tokens\nghost,1,1\nghost,1,1\n"
        _, out, _ = self.run_usage(usage, "reprice", "--on", "2027-01-01")
        line = "  ghost: 2 requests, no price row for this model (first at line 2)"
        self.assertIn(line, block(out, "UNPRICED ON 2026-10-31"))
        self.assertIn(line, block(out, "UNPRICED ON 2027-01-01"))


class SeedPrices(unittest.TestCase):
    """The bundled src/aicost/data/prices.toml works through the commands. No dollar values are asserted,
    because they change whenever the seed prices are re-checked."""

    def test_report_runs_on_the_seed_prices(self):
        code, out, err = run("report", SEED_USAGE, "--prices", SEED_PRICES, "--today", SEED_TODAY)
        self.assertEqual((code, err), (0, ""))
        self.assertIn("Requests: 3 read, 3 priced, 0 unpriced", out)
        self.assertIn("anthropic / claude-haiku-5-5", out)
        self.assertIn("google / gemini-3.8-flash", out)
        self.assertNotIn("[stale]", out)

    def test_schedule_finds_the_january_1_2027_change(self):
        code, out, _ = run("schedule", SEED_USAGE, "--prices", SEED_PRICES, "--today", SEED_TODAY)
        self.assertEqual(code, 0)
        self.assertIn("2027-01-01  google / gemini-3.8-flash  (in 61 days)", out)

    def test_reprice_runs_on_the_seed_prices(self):
        code, out, err = run(
            "reprice", SEED_USAGE, "--prices", SEED_PRICES, "--today", SEED_TODAY, "--on", "2027-01-01"
        )
        self.assertEqual((code, err), (0, ""))
        self.assertIn("google / gemini-3.8-flash: now", out)


class DefaultPrices(unittest.TestCase):
    """Without --prices the seed table bundled in the package is used, from any folder."""

    def test_no_prices_flag_uses_the_bundled_table(self):
        code, out, err = run("report", SEED_USAGE, "--today", SEED_TODAY)
        self.assertEqual((code, err), (0, ""))
        self.assertIn("Prices: bundled seed prices (aicost/data/prices.toml)", out)
        self.assertIn("Requests: 3 read, 3 priced, 0 unpriced", out)

    def test_bundled_table_matches_the_explicit_file(self):
        _, bundled, _ = run("report", SEED_USAGE, "--today", SEED_TODAY)
        _, explicit, _ = run("report", SEED_USAGE, "--prices", SEED_PRICES, "--today", SEED_TODAY)
        self.assertEqual(bundled.splitlines()[2:], explicit.splitlines()[2:])

    def test_works_from_an_unrelated_folder(self):
        with tempfile.TemporaryDirectory() as directory:
            done = subprocess.run(
                [sys.executable, "-m", "aicost.cli", "schedule", str(SEED_USAGE), "--today", SEED_TODAY],
                capture_output=True,
                text=True,
                encoding="utf-8",
                cwd=directory,
            )
        self.assertEqual((done.returncode, done.stderr), (0, ""))
        self.assertIn("2027-01-01  google / gemini-3.8-flash", done.stdout)


class Subprocess(unittest.TestCase):
    def test_module_runs_as_a_program(self):
        done = subprocess.run(
            [sys.executable, "-m", "aicost.cli", "report", str(CSV), "--prices", str(PRICES), "--today", TODAY],
            capture_output=True,
            text=True,
            encoding="utf-8",
        )
        self.assertEqual((done.returncode, done.stderr), (0, ""))
        self.assertIn("cost with bands:       $2.6900", done.stdout)


if __name__ == "__main__":
    unittest.main()
