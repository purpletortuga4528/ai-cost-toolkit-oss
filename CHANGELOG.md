# Changelog
All notable changes are listed here, newest first. Versions follow semantic versioning;
dates are YYYY-MM-DD. The layout follows the common "Keep a Changelog" convention.

## [Unreleased]

## [0.1.0] - 2026-11-16
### Added
- `aicost report`: spend by band, share of spend above each threshold, and the gap to
  headline-rate cost.
- `aicost schedule`: scheduled price changes that touch models in a usage export.
- `aicost reprice --on DATE`: the same usage priced under the rates in force on a given date.
- Usage reader for CSV and JSON Lines exports (`model`, `input_tokens`, `output_tokens`, and
  an optional `provider`).
- Price table format with a boundary rule (`at_or_below` or `under`), a per-row
  `applies_to` setting (`whole_request` or `marginal`), source URL, as-of date, tier, and
  shelf life, plus a validator that reports every problem in a file.
- Stale-data and tier C warnings.
- Seed prices for 19 models from three providers (Google, Anthropic, and OpenAI), each read
  from the provider's own page on 2026-11-16 (see the README for the list, and for the two
  Gemini Pro rows, tier B, whose whole-request rule comes from Google's Vertex AI page).
  `gemini-2.5-pro` carries dated steps to Gemini 3.8 Flash rates on 2026-12-01 and 2027-01-01
  (the second is inferred, tier B).
- Unpriced requests are listed once per provider, model, and reason, with a count and the first
  line number.
- A token count may be at most 1,000,000,000,000,000 and a rate at most 1,000,000 dollars per
  million tokens; larger values are reported as problems.
- A usage or price file that cannot be read (not valid UTF-8, or a number or nesting too large
  to read) is a reported problem with exit code 1, never a crash. A price table may start with a
  byte order mark.
- Text taken from files (file names, providers, and models) is printed with non-ASCII
  characters escaped.
- A hint when every problem in a price table is a row checked after the date in use, for
  example with an early `--today` or a wrong computer date.
- Command line only. No network calls.
