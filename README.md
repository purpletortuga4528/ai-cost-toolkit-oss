# AI Cost Toolkit

A command-line tool that reads your own API usage export and shows what share of your spend sits above each provider's long-context price threshold, which of your models have a scheduled price change, and what the same usage would cost on a future date. Version 0.1.0.

## What it does
- Reads a usage export, CSV or JSON Lines, with one row per request. Required fields: `model`, `input_tokens`, and `output_tokens`. Optional: `provider`. Other columns are ignored. Token counts must be whole numbers, zero or more and at most 1,000,000,000,000,000.
- Reads a price table (TOML) with, for each row: provider, model, band threshold, boundary rule (at or below, or under), whether the upper band prices the whole request or only the tokens beyond the threshold, rates per band, effective-from date, source URL, as-of date, tier, and shelf life in days (30 by default).
- `aicost report USAGE`: spend by band, the share of spend above each threshold, and the gap between banded cost and headline-rate cost (every request priced at its lower band's rates).
- `aicost schedule USAGE`: every scheduled price change in the table that touches a model in your usage, with its date and the before and after rates.
- `aicost reprice USAGE --on DATE`: what the same usage costs under the prices in force on a future date, such as the first day of next year.
- Warns when a price row is older than its shelf life, or when a row is tier C.
- Lists every request it could not price (no matching row, a model name found under more than one provider, or a price not yet in force) instead of dropping it, grouped by provider, model, and reason, with a count and the first line number.

Options shared by all three commands:

| Option | Meaning |
| --- | --- |
| `--prices FILE` | Price table to use. Default: the seed prices bundled with the package. |
| `--format csv\|jsonl` | Usage file format. Default: decided by the file suffix (`.csv` or `.jsonl`). |
| `--today YYYY-MM-DD` | Treat this as today's date. Default: the system date. It sets which price rows are in force and which are stale. |

`reprice` also requires `--on YYYY-MM-DD`. Exit codes: 0 on success, 1 when a price or usage file cannot be used (problems are printed on standard error), 2 for a mistake on the command line. Text taken from your files (file names, providers, and models) is printed with any character outside printable ASCII shown as a backslash escape.

Example, on a made-up three-request export (`tests/fixtures/seed_usage.csv`), trimmed:

```text
$ aicost report seed_usage.csv --today 2026-11-16
anthropic / claude-haiku-5-5  (price row effective 2026-10-31, tier A)
  band: threshold 100,000 input tokens; a request at exactly the threshold stays in the lower band; the upper band prices the whole request
  rates, $ per 1M tokens: input $0.10 / $0.50, output $0.50 / $2.50 (lower / upper band)
  requests: 2, of which 1 above the threshold
  cost with bands:       $0.0900
  cost at headline rate: $0.0300
  gap:                   $0.0600
  share of spend above the threshold: 83.3%
```

## What it does not do
The app is not an invoice, a billing reconciliation, or a forecast. It does not predict your future usage and does not recommend a provider. It does not give financial advice.

- It estimates spend from token counts and the rates in the table. It does not model cache pricing, batch or flex discounts, regional processing, tool charges, credits, or taxes. Every report says so.
- Cache reads are billed at a fraction of the input price, and this tool prices every input token at the full input rate. On usage with many cache reads, such as coding-agent sessions, the cost figures overstate what you pay. The share of spend above a threshold is the more reliable output, and it exists only for models that have a threshold row.
- It does not read any provider's own export format. You map your export to the columns above first. Where a provider counts cached tokens toward prompt length (one provider's page says it does), put those tokens in `input_tokens`, or the band will be wrong.
- It looks nothing up. Prices come only from the table, and the table holds only the rows listed under "Data and sources". A model that is not in the table is listed as unpriced.
- The seed table is a sample, not a full catalog. It holds the models listed under "Data and sources" and no others. A model that is missing is a gap in the seed, not a finding about that provider.
- Two rules rest on less than a plain statement. Google's Gemini API pricing page, as read on 2026-11-16, shows a 200k band for Gemini 3.1 Pro Preview and Gemini 2.5 Pro but does not say whether the higher rate covers the whole request. The `whole_request` setting on those two rows comes from Google's separate Vertex AI pricing page, which says all tokens are charged at the long-context rate above 200K. And no OpenAI or Google page defines "K". This project reads K as 1,000, so 272K is 272,000 and 200k is 200,000. If a provider meant 1,024 per K, the thresholds would be 278,528 and 204,800, and requests between the two counts would be banded wrongly.

What would show its output wrong:
- A provider invoice for a period of usage that is entirely on models in the table, with no cache, batch, or regional pricing, that differs from the report's cost with bands by more than rounding.
- A request exactly at a threshold that the provider bills in the other band from the one the row's boundary rule gives.
- A banded row where the provider charges the higher rate only on the tokens beyond the threshold, but the row says `whole_request` (or the reverse). The Claude Haiku 5.5 row's `whole_request` setting rests on Anthropic's pricing page, which lists rates "for prompts up to 100,000 tokens" and "for prompts over 100,000 tokens" and says a request over the threshold "pays higher prices". The page does not use the words "whole request"; the row reads that sentence as pricing both the input and the output of such a request at the higher rates. The two Gemini Pro rows rest on the Vertex AI page, as described above. The OpenAI rows rest on each model page's "for the full request" (GPT-5.5 and GPT-5.4: "for the full session").
- A provider page whose current price differs from the row. Prices change, and a row older than its shelf life triggers a warning, but a change inside the shelf life will not.

## Prior art
Eight existing tools were checked on 2026-10-31 from their own pages or package metadata. This reads page summaries, not source code, so a page that is silent on a feature does not prove the feature is missing.

| Tool (license as stated on its page) | What it does | How this app differs |
| --- | --- | --- |
| [ModelSpend](https://github.com/rmencke2/modelspend) (Apache-2.0, beta) | Tracks and routes LLM spend; imports an OpenAI usage CSV to reconcile. Its page does not mention long-context bands or future-dated prices. | Prices each request by band, reports the share above each threshold, and re-prices at a future date. |
| [tokencost](https://github.com/AgentOps-AI/tokencost) (MIT) | Client-side token counting and one prompt price and one completion price per model. | Banded, dated prices, and reads usage exports. |
| [LiteLLM price file](https://docs.litellm.ai/docs/provider_registration/add_model_pricing) | Tiers are keys such as `input_cost_per_token_above_200k_tokens`. The page states no boundary rule for them and defines no effective-date, source-URL, or as-of fields. | Stores the boundary rule and provenance fields on every row. |
| [ccusage](https://github.com/ryoppippi/ccusage) (MIT) | Reads local coding-agent logs; prices come from the LiteLLM file, with per-model overrides. | General usage export in, band report out; not tied to coding agents. |
| [RunCost](https://pkg.go.dev/github.com/adamallcock/runcost) (MIT, alpha; this row describes v0.1.3, and a later version exists that was not re-read) | Per-call cost ledger. Custom price cards may carry long-context prices and historical effective dates; has a stale-price warning. Does not read exports or report share above a threshold. | Closest on dates and stale warnings; this app works on a whole period of usage. |
| [PromptSpend](https://github.com/AndrewAvery7/promptspend) (MIT) | Price catalog with a per-model long-context threshold, a last-verified date, and an as-of query. Its page does not state whether the boundary is inclusive. | Stores the boundary rule as data and reports on your own usage. |
| [llm-catalogue](https://pypi.org/pypi/llm-catalogue/json) 0.2.5 (MIT) | Price list with tiered pricing (threshold and over-threshold rate). No boundary rule or effective dates; reads no exports. | A checker rather than a list. |
| [llm-costs](https://pypi.org/pypi/llm-costs/json) 0.1.6 (MIT per its description) | Per-call calculator that flags when long-context pricing applied. No usage files or effective dates described. | Period-level report, dated prices. |

None of these pages, on that date, described a tool that combines a usage-export reader, a stored boundary rule, a share-above-threshold report, and future-dated re-pricing. That is a finding about those pages on that date, not proof that no such tool exists.

## Install and run
Requires Python 3.12 or newer. There are no third-party dependencies. From a clone of this repository, preferably inside a virtual environment ([Python's venv documentation](https://docs.python.org/3.12/library/venv.html)):

```bash
python -m pip install .
aicost report usage.csv
aicost schedule usage.csv
aicost reprice usage.csv --on 2027-01-01
```

To use your own prices, copy `src/aicost/data/prices.toml`, edit it, and pass it with `--prices`. Every key is validated; an unknown, missing, or invalid key is an error, and all problems in a file are reported together.

Price table format: `schema_version = 1`, then one `[[price]]` table per row. A scheduled change is a second row for the same model with a later `effective_from`.

| Key | Rule |
| --- | --- |
| `provider`, `model` | Required text. |
| `effective_from` | Required TOML date. |
| `input_per_mtok`, `output_per_mtok` | Required, US dollars per million tokens, not negative and at most 1,000,000. The rates at or below the threshold, or the only band. |
| `threshold_tokens`, `boundary`, `applies_to`, `input_per_mtok_above`, `output_per_mtok_above` | All present (two bands) or all absent (one band). `boundary` is `at_or_below` or `under`; `applies_to` is `whole_request` or `marginal`. The count compared with the threshold is the request's input tokens. |
| `source_url`, `as_of`, `tier` | Required. `as_of` is the date you read the source and may not be in the future. `tier` is `A`, `B`, or `C`; `C` produces a warning. |
| `shelf_life_days` | Optional, 30 by default. A row is stale when today minus `as_of` is greater than this. |
| `notes` | Optional text. |

For a checkout you plan to edit, install with `python -m pip install -e .` instead.

Run the tests, from the repository root, with: `python -m unittest discover -s tests`.

## Network calls
This app makes no network calls. It reads the usage file and the price table, and it writes to standard output and standard error. No telemetry. Your usage file stays on your machine.

## Data and sources
Every row below was read from the provider's own pricing page on its as-of date (the whole-request rule for the two Gemini Pro rows and the OpenAI long-context rule come from other provider pages, named under "Sources"), as US dollars per million tokens, Standard (not batch or flex) paid-tier text prices. All rows were re-read on 2026-11-16. All rows are tier A (verified against the primary source) except the two Gemini Pro rows effective 2026-10-31, which are tier B because their whole-request rule comes from Google's Vertex AI page, and the 2027-01-01 `gemini-2.5-pro` row, which is tier B because its rate is inferred. Every row has a shelf life of 30 days except `gpt-5.6-sol` (14 days), so the tool warns about a row from 2026-12-17 (rows read on 2026-11-16), and about `gpt-5.6-sol` from 2026-12-01, the day after its promotion ends, until it is re-checked. Tier B raises no warning of its own; only tier C does. The pages state when a current price ends or changes, not when it began, so each current row uses the date it was first checked as its effective-from date. Seed prices are refreshed about every four weeks on a best-effort basis; the tool warns when a row is older than its shelf life.

| Provider and model | Effective from | Input / output | Band | As of | Tier | Shelf life |
| --- | --- | --- | --- | --- | --- | --- |
| Google `gemini-3.8-flash` | 2026-10-31 | 0.75 / 3.75 | single | 2026-11-16 | A | 30 days |
| Google `gemini-3.8-flash` | 2027-01-01 | 1.50 / 7.50 | single | 2026-11-16 | A | 30 days |
| Google `gemini-3.6-flash` | 2026-10-31 | 0.75 / 3.75 | single | 2026-11-16 | A | 30 days |
| Google `gemini-3.6-flash` | 2027-01-01 | 1.50 / 7.50 | single | 2026-11-16 | A | 30 days |
| Google `gemini-4-argon` | 2026-10-31 | 2.00 / 10.00 | single | 2026-11-16 | A | 30 days |
| Google `gemini-4-argon` | 2026-12-01 | 4.00 / 20.00 | single | 2026-11-16 | A | 30 days |
| Google `gemini-3.1-pro-preview` | 2026-10-31 | 2.00 / 12.00 up to 200,000 input tokens; 4.00 / 18.00 above | 200,000, at or below stays lower; upper band prices the whole request | 2026-11-16 | B | 30 days |
| Google `gemini-2.5-pro` | 2026-10-31 | 1.25 / 10.00 up to 200,000 input tokens; 2.50 / 15.00 above | 200,000, at or below stays lower; upper band prices the whole request | 2026-11-16 | B | 30 days |
| Google `gemini-2.5-pro` | 2026-12-01 | 0.75 / 3.75 | single | 2026-11-16 | A | 30 days |
| Google `gemini-2.5-pro` | 2027-01-01 | 1.50 / 7.50 (inferred, see note) | single | 2026-11-16 | B | 30 days |
| Anthropic `claude-haiku-5-5` | 2026-10-31 | 0.10 / 0.50 up to 100,000 input tokens; 0.50 / 2.50 above | 100,000, at or below stays lower; upper band prices the whole request | 2026-11-16 | A | 30 days |
| Anthropic `claude-opus-5` | 2026-11-01 | 5.00 / 25.00 | single | 2026-11-16 | A | 30 days |
| Anthropic `claude-opus-5-5` | 2026-11-01 | 4.00 / 20.00 | single | 2026-11-16 | A | 30 days |
| Anthropic `claude-sonnet-5` | 2026-11-01 | 2.00 / 10.00 | single | 2026-11-16 | A | 30 days |
| Anthropic `claude-sonnet-5-5` | 2026-11-01 | 2.00 / 10.00 | single | 2026-11-16 | A | 30 days |
| OpenAI `gpt-6-astra` | 2026-10-31 | 10.00 / 50.00 up to 272,000 input tokens; 20.00 / 75.00 above | 272,000, at or below stays lower; upper band prices the whole request | 2026-11-16 | A | 30 days |
| OpenAI `gpt-6.1-sol` | 2026-10-31 | 2.00 / 10.00 up to 272,000 input tokens; 4.00 / 15.00 above | same as above | 2026-11-16 | A | 30 days |
| OpenAI `gpt-6.1-terra` | 2026-10-31 | 1.00 / 5.00 up to 272,000 input tokens; 2.00 / 7.50 above | same as above | 2026-11-16 | A | 30 days |
| OpenAI `gpt-6-luna` | 2026-10-31 | 0.10 / 0.50 up to 272,000 input tokens; 0.20 / 0.75 above | same as above | 2026-11-16 | A | 30 days |
| OpenAI `gpt-5.6-sol` | 2026-10-31 | 4.00 / 20.00 up to 272,000 input tokens; 8.00 / 30.00 above (promotional, see note) | same as above | 2026-11-16 | A | 14 days |
| OpenAI `gpt-5.6-terra` | 2026-10-31 | 2.00 / 12.00 up to 272,000 input tokens; 4.00 / 18.00 above | same as above | 2026-11-16 | A | 30 days |
| OpenAI `gpt-5.6-luna` | 2026-10-31 | 0.20 / 1.20 up to 272,000 input tokens; 0.40 / 1.80 above | same as above | 2026-11-16 | A | 30 days |
| OpenAI `gpt-5.5` | 2026-10-31 | 5.00 / 30.00 up to 272,000 input tokens; 10.00 / 45.00 above | same as above | 2026-11-16 | A | 30 days |
| OpenAI `gpt-5.4` | 2026-10-31 | 2.50 / 15.00 up to 272,000 input tokens; 5.00 / 22.50 above | same as above | 2026-11-16 | A | 30 days |

The OpenAI upper rates are computed: the model pages give them as 2x the input rate and 1.5x the output rate. OpenAI's pricing page and model page, read on 2026-11-16, say the `gpt-5.6-sol` price is promotional until November 30, 2026 and state no later price. Check OpenAI's page before relying on that row after that date.

Google's pages say that from 2026-12-01 requests to `gemini-2.5-pro` are billed at Gemini 3.8 Flash rates. The 2026-12-01 row follows that statement; the 2027-01-01 row is inferred from Flash's own page.

Sources:
- Google rows: https://aistudio.google.com/docs/pricing (read 2026-11-16), with the deprecation and routing statement for `gemini-2.5-pro` also on https://aistudio.google.com/docs/deprecations. The whole-request rule for the two Pro rows is from https://cloud.google.com/model-garden/pricing (Vertex AI, now titled Agent Platform Pricing, a different Google product), read 2026-10-31 and again 2026-11-16.
- Anthropic rows: https://platform.claude.com/docs/en/about-claude/pricing (read 2026-11-16; the four Opus and Sonnet rows are single band because the page says Claude 4.6 and later models other than Haiku 5.5 include the full 1M token context window at standard pricing). Model IDs come from https://platform.claude.com/docs/en/about-claude/models/overview and https://platform.claude.com/docs/en/about-claude/models/model-ids-and-versions, and all four IDs are listed as Active on https://platform.claude.com/docs/en/about-claude/model-deprecations. Fast mode and cache prices are not modeled.
- OpenAI rows: rates and the 272K toggle from https://developers.openai.com/api/docs/pricing; the long-context rule from each model's page, `https://developers.openai.com/api/docs/models/<model>`, read 2026-11-16 in a browser, one visit per page.

Each row in `src/aicost/data/prices.toml` carries its own source URL, as-of date, tier, shelf life, and a note quoting the page wording it follows.

## Licenses
Code (`src/aicost/` Python files, `tests/`, and `pyproject.toml`) is under Apache-2.0 (`LICENSE`). The seed price table in `src/aicost/data/` is under CC BY 4.0 (`LICENSE-CONTENT`); to reuse it, credit "purpletortuga4528, ai-cost-toolkit seed prices" and link the license. Test fixtures are invented data and fall under the code license. Cited third-party excerpts and quotations stay under their owners' terms, and the prices themselves are facts published by the providers.

## Notices
Provider and model names appear only to identify prices. This project is not affiliated with or endorsed by any model provider.

## AI-use disclosure
Much of the code, tests, and documentation in this project was drafted with AI assistance.
