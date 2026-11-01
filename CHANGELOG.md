# Changelog
All notable changes are listed here, newest first. Versions follow semantic versioning;
dates are YYYY-MM-DD. The layout follows the common "Keep a Changelog" convention.

## [Unreleased]

## [0.1.0] - YYYY-MM-DD
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
  from the provider's own page on 2026-10-31 or 2026-11-01 (see the README for the list, and
  for the two Gemini Pro rows, tier B, whose whole-request rule comes from Google's Vertex AI
  page).
- Unpriced requests are listed once per provider, model, and reason, with a count and the first
  line number.
- Command line only. No network calls.
