"""Command line: report, schedule, and reprice.

All three read a price table (TOML) and a usage export (CSV or JSON Lines). Output is plain
ASCII text on standard output; problems with the input files go to standard error and exit
code 1. Money is rounded to four decimals for display only; the arithmetic is exact.
"""

from __future__ import annotations

import argparse
import datetime
import sys
from decimal import Decimal
from pathlib import Path

from aicost.bandcost import (
    BandSpend,
    SpendReport,
    UsageError,
    UsageRecord,
    load_usage,
    spend_by_band,
)
from aicost.core import (
    PriceRow,
    PriceTableError,
    PriceWarning,
    load_price_table,
    stale_warnings,
    tier_warnings,
)

DEFAULT_PRICES = Path("data") / "prices.toml"
EXIT_INPUT_ERROR = 1

NOTE = (
    "Spend is estimated from the token counts in the export at the rates in the price table. "
    "It does not include cache pricing, batch discounts, or anything else the table does not hold."
)


# ---------------------------------------------------------------- formatting


def _money(value: Decimal) -> str:
    return f"${value:,.4f}"


def _signed_money(value: Decimal) -> str:
    return f"{'+' if value >= 0 else '-'}${abs(value):,.4f}"


def _percent(fraction: Decimal) -> str:
    return f"{fraction * 100:.1f}%"


def _signed_percent(fraction: Decimal) -> str:
    return f"{'+' if fraction >= 0 else '-'}{abs(fraction) * 100:.1f}%"


def _rate(value: Decimal) -> str:
    whole, _, fraction = f"{value.normalize():f}".partition(".")
    return f"{whole}.{fraction.ljust(2, '0')}"


def _boundary_text(row: PriceRow) -> str:
    if row.boundary == "at_or_below":
        return "a request at exactly the threshold stays in the lower band"
    return "a request at exactly the threshold is in the upper band"


def _applies_text(row: PriceRow) -> str:
    if row.applies_to == "whole_request":
        return "the upper band prices the whole request"
    return "the upper band prices only the input tokens beyond the threshold"


def _rates_text(row: PriceRow) -> str:
    if row.threshold_tokens is None:
        return f"input ${_rate(row.input_per_mtok)}, output ${_rate(row.output_per_mtok)}"
    return (
        f"input ${_rate(row.input_per_mtok)} / ${_rate(row.input_per_mtok_above)}, "
        f"output ${_rate(row.output_per_mtok)} / ${_rate(row.output_per_mtok_above)}"
        " (lower / upper band)"
    )


def _label(row: PriceRow) -> str:
    return f"{row.provider} / {row.model}"


def _plural(count: int, word: str) -> str:
    return f"{count:,} {word}{'' if count == 1 else 's'}"


# ---------------------------------------------------------------- matching


def _touches(row: PriceRow, record: UsageRecord) -> bool:
    """Same match rule as price selection: exact model, and provider when the record names one."""
    return row.model == record.model and (record.provider is None or record.provider == row.provider)


def _records_for(row: PriceRow, records: tuple[UsageRecord, ...]) -> list[UsageRecord]:
    return [record for record in records if _touches(row, record)]


def _relevant_rows(rows: tuple[PriceRow, ...], records: tuple[UsageRecord, ...]) -> tuple[PriceRow, ...]:
    return tuple(row for row in rows if _records_for(row, records))


# ---------------------------------------------------------------- shared sections


def _print_warnings(rows: tuple[PriceRow, ...], records: tuple[UsageRecord, ...], today: datetime.date) -> None:
    """Stale-data and tier C warnings for every price row that touches a model in the export."""
    relevant = _relevant_rows(rows, records)
    warnings: list[PriceWarning] = stale_warnings(relevant, today) + tier_warnings(relevant)
    warnings.sort(key=lambda w: (w.provider, w.model, w.effective_from, w.kind))
    print()
    print("WARNINGS")
    if not warnings:
        print("  none")
    for warning in warnings:
        print(
            f"  - {warning.provider} / {warning.model} (row effective {warning.effective_from}) "
            f"[{warning.kind}] {warning.message}"
        )


def _print_unpriced(report: SpendReport, heading: str) -> None:
    if not report.unpriced:
        return
    print()
    print(heading)
    for item in report.unpriced:
        who = f"{item.record.provider} / " if item.record.provider else ""
        print(f"  line {item.record.line}: {who}{item.record.model}: {item.reason}")


def _sorted_groups(report: SpendReport) -> list[BandSpend]:
    return sorted(report.groups, key=lambda g: (g.row.provider, g.row.model, g.row.effective_from))


# ---------------------------------------------------------------- report


def _print_group(group: BandSpend) -> None:
    row = group.row
    print()
    print(f"{_label(row)}  (price row effective {row.effective_from}, tier {row.tier})")
    if row.threshold_tokens is None:
        print("  band: single band, no threshold")
    else:
        print(
            f"  band: threshold {row.threshold_tokens:,} input tokens; {_boundary_text(row)}; "
            f"{_applies_text(row)}"
        )
    print(f"  rates, $ per 1M tokens: {_rates_text(row)}")
    if row.threshold_tokens is None:
        print(f"  requests: {group.requests:,}")
    else:
        print(f"  requests: {group.requests:,}, of which {group.requests_upper:,} above the threshold")
    print(f"  tokens: {group.input_tokens:,} input, {group.output_tokens:,} output")
    print(f"  cost with bands:       {_money(group.banded_cost)}")
    print(f"  cost at headline rate: {_money(group.headline_cost)}")
    print(f"  gap:                   {_money(group.gap)}")
    share = group.share_above
    if row.threshold_tokens is None:
        print("  share of spend above the threshold: n/a (single band)")
    elif share is None:
        print("  share of spend above the threshold: n/a (no spend)")
    else:
        print(f"  share of spend above the threshold: {_percent(share)}")
    if row.applies_to == "marginal":
        print(
            f"  input tokens priced at the upper rate: {group.upper_input_tokens:,}; "
            f"cost at upper-band rates (those tokens plus output): {_money(group.upper_rate_cost)}"
        )


def cmd_report(args: argparse.Namespace, rows: tuple[PriceRow, ...], records: tuple[UsageRecord, ...]) -> int:
    report = spend_by_band(records, rows, args.today)
    priced = len(records) - len(report.unpriced)
    print(f"REPORT: {args.usage}")
    print(f"Prices: {args.prices}, in force on {args.today}")
    print(f"Requests: {len(records):,} read, {priced:,} priced, {len(report.unpriced):,} unpriced")
    _print_warnings(rows, records, args.today)
    print()
    print("SPEND BY BAND")
    for group in _sorted_groups(report):
        _print_group(group)
    print()
    print("TOTAL (priced requests only)")
    print(f"  cost with bands:       {_money(report.banded_cost)}")
    print(f"  cost at headline rate: {_money(report.headline_cost)}")
    print(f"  gap:                   {_money(report.gap)}")
    print("  The headline rate prices every request at its lower band's rates.")
    _print_unpriced(report, "UNPRICED REQUESTS (not in any total)")
    print()
    print(f"Note: {NOTE}")
    return 0


# ---------------------------------------------------------------- schedule


def _previous_row(row: PriceRow, rows: tuple[PriceRow, ...]) -> PriceRow | None:
    earlier = [
        other
        for other in rows
        if other.provider == row.provider and other.model == row.model and other.effective_from < row.effective_from
    ]
    return max(earlier, key=lambda other: other.effective_from, default=None)


def _change(old: Decimal, new: Decimal) -> str:
    if old == 0:
        return "n/a" if new == 0 else "new non-zero rate"
    return _signed_percent((new - old) / old)


def cmd_schedule(args: argparse.Namespace, rows: tuple[PriceRow, ...], records: tuple[UsageRecord, ...]) -> int:
    scheduled = sorted(
        (row for row in _relevant_rows(rows, records) if row.effective_from > args.today),
        key=lambda row: (row.effective_from, row.provider, row.model),
    )
    print(f"SCHEDULE: {args.usage}")
    print(f"Prices: {args.prices}; today is {args.today}")
    _print_warnings(rows, records, args.today)
    print()
    print("SCHEDULED PRICE CHANGES TOUCHING MODELS IN THIS EXPORT")
    if not scheduled:
        print("  none: no row in the price table takes effect after today for these models.")
        print("  This lists only changes recorded in the table; it does not look anything up.")
    for row in scheduled:
        days = (row.effective_from - args.today).days
        print()
        print(f"{row.effective_from}  {_label(row)}  (in {_plural(days, 'day')})")
        before = _previous_row(row, rows)
        if before is None:
            print("  before: no earlier price row for this model in the table")
        else:
            print(f"  before (row effective {before.effective_from}): {_rates_text(before)}")
        print(f"  after:  {_rates_text(row)}")
        if before is not None:
            print(
                f"  change in lower-band rates: input {_change(before.input_per_mtok, row.input_per_mtok)}, "
                f"output {_change(before.output_per_mtok, row.output_per_mtok)}"
            )
            if (before.threshold_tokens, before.boundary, before.applies_to) != (
                row.threshold_tokens,
                row.boundary,
                row.applies_to,
            ):
                print("  the band rule itself changes; compare the two rows in the price table")
        matched = _records_for(row, records)
        print(
            f"  your usage for this model: {_plural(len(matched), 'request')}, "
            f"{sum(r.input_tokens for r in matched):,} input tokens, "
            f"{sum(r.output_tokens for r in matched):,} output tokens"
        )
        print(f"  source: {row.source_url} (checked {row.as_of}, tier {row.tier})")
    print()
    print("Use 'reprice --on DATE' to see what your usage would cost on a given date.")
    return 0


# ---------------------------------------------------------------- reprice


def _totals_by_model(report: SpendReport) -> dict[tuple[str, str], Decimal]:
    totals: dict[tuple[str, str], Decimal] = {}
    for group in report.groups:
        key = (group.row.provider, group.row.model)
        totals[key] = totals.get(key, Decimal(0)) + group.banded_cost
    return totals


def _change_text(now: Decimal, then: Decimal) -> str:
    text = _signed_money(then - now)
    if now != 0:
        text += f" ({_signed_percent((then - now) / now)})"
    return text


def cmd_reprice(args: argparse.Namespace, rows: tuple[PriceRow, ...], records: tuple[UsageRecord, ...]) -> int:
    now_report = spend_by_band(records, rows, args.today)
    then_report = spend_by_band(records, rows, args.on)
    now_totals = _totals_by_model(now_report)
    then_totals = _totals_by_model(then_report)

    print(f"REPRICE: {args.usage}")
    print(f"Prices: {args.prices}")
    print(f"Same usage priced in force on {args.today} (now) and on {args.on} (then)")
    _print_warnings(rows, records, args.today)
    print()
    print("COST BY MODEL, with bands")
    for key in sorted(set(now_totals) | set(then_totals)):
        now = now_totals.get(key)
        then = then_totals.get(key)
        who = f"{key[0]} / {key[1]}"
        if now is None or then is None:
            side = "now" if now is None else "then"
            print(f"  {who}: not priced {side}; no comparison")
        else:
            print(f"  {who}: now {_money(now)}, then {_money(then)}, change {_change_text(now, then)}")
    print()
    print("TOTAL (priced requests only)")
    print(f"  now:    {_money(now_report.banded_cost)}")
    print(f"  then:   {_money(then_report.banded_cost)}")
    print(f"  change: {_change_text(now_report.banded_cost, then_report.banded_cost)}")
    now_lines = {item.record.line for item in now_report.unpriced}
    then_lines = {item.record.line for item in then_report.unpriced}
    if now_lines != then_lines:
        print("  WARNING: some requests are priced on only one of the two dates, so these totals")
        print("  do not cover the same requests.")
    _print_unpriced(now_report, f"UNPRICED ON {args.today} (now)")
    _print_unpriced(then_report, f"UNPRICED ON {args.on} (then)")
    print()
    print(f"Note: {NOTE}")
    return 0


# ---------------------------------------------------------------- entry point


def _date(text: str) -> datetime.date:
    try:
        return datetime.date.fromisoformat(text)
    except ValueError:
        raise argparse.ArgumentTypeError(f"not a valid date: {text!r} (expected YYYY-MM-DD)") from None


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="aicost",
        description=(
            "Check what share of your AI API spend sits above each provider's long-context "
            "price threshold, which of your models have a scheduled price change, and what "
            "your usage would cost on a future date."
        ),
    )
    commands = parser.add_subparsers(dest="command", required=True, metavar="command")

    def common(sub: argparse.ArgumentParser) -> None:
        sub.add_argument("usage", type=Path, help="usage export: .csv or .jsonl (model, input_tokens, output_tokens)")
        sub.add_argument(
            "--prices",
            type=Path,
            default=DEFAULT_PRICES,
            help="price table (TOML); default: %(default)s in the current folder",
        )
        sub.add_argument(
            "--format",
            choices=("csv", "jsonl"),
            default=None,
            help="usage file format; default: decided by the file suffix",
        )
        sub.add_argument(
            "--today",
            type=_date,
            default=None,
            metavar="YYYY-MM-DD",
            help="treat this as today's date (default: the system date)",
        )

    report = commands.add_parser("report", help="spend by band, share above each threshold, gap to headline cost")
    common(report)
    report.set_defaults(func=cmd_report)

    schedule = commands.add_parser("schedule", help="scheduled price changes that touch models in the export")
    common(schedule)
    schedule.set_defaults(func=cmd_schedule)

    reprice = commands.add_parser("reprice", help="what the same usage costs on a future date")
    common(reprice)
    reprice.add_argument("--on", type=_date, required=True, metavar="YYYY-MM-DD", help="date to price the usage on")
    reprice.set_defaults(func=cmd_reprice)
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    args.today = args.today or datetime.date.today()
    try:
        rows = load_price_table(args.prices, args.today)
    except PriceTableError as error:
        return _input_error(args.prices, error.problems)
    except OSError as error:
        return _input_error(args.prices, [error.strerror or str(error)])
    try:
        records = load_usage(args.usage, args.format)
    except UsageError as error:
        return _input_error(args.usage, error.problems)
    except OSError as error:
        return _input_error(args.usage, [error.strerror or str(error)])
    return args.func(args, rows, records)


def _input_error(path: Path, problems: list[str]) -> int:
    print(f"error: cannot use {path}:", file=sys.stderr)
    for problem in problems:
        print(f"  {problem}", file=sys.stderr)
    return EXIT_INPUT_ERROR


if __name__ == "__main__":
    sys.exit(main())
