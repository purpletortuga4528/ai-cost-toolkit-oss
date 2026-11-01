# Contributing

Issues are turned off for this repository. Pull requests are welcome and are reviewed on a
best-effort basis, so there is no promised response time. This may change after the first
release.

## Data corrections
A wrong or stale price is the most useful contribution. Open a pull request that changes the
row in `src/aicost/data/prices.toml`, and say in the description which provider page you read
and on what date. Please read the provider's own page, not a summary of it. Update the row's
`source_url`, `as_of`, `tier`, and `shelf_life_days` to match what you checked, and keep the
page's wording in `notes` where the row depends on it. If you cannot open a pull request,
there is no other channel for corrections in the first release.

## Code changes
The code needs Python 3.12 or newer and uses only the standard library. Run the tests with
`python -m unittest discover -s tests` from the repository root. A change to how a price is
computed needs a test with a hand-worked expected value, including a request exactly at the
threshold when the change touches the band rule.

## Do not include
Secrets, personal data, or content you do not have the right to share. Commits keep their
author's name and email as you set them in git; if you do not want your email shown, use your
GitHub no-reply address.

## Licensing of contributions
By opening a pull request you agree that your contribution may be distributed under the
repository's licenses: Apache-2.0 for code and CC BY 4.0 for the seed data. For code,
section 5 of the Apache License (in `LICENSE`) says a contribution you intentionally submit
for inclusion is under that license unless you state otherwise. For the seed data, this
statement is the project's own agreement; it does not rely on a clause in CC BY 4.0.
