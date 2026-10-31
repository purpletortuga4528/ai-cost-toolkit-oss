"""Every shipped seed price must carry a source URL, an as-of date, and a tier.

The validator already requires all three, so loading data/prices.toml is the test.
data/prices.toml does not exist yet: seed prices are added and checked against each
provider's own page in session 3. Until then this test is skipped, not passed. Remove the
skip when the file lands.
"""

import unittest
from pathlib import Path

from aicost.core import load_price_table

SEED = Path(__file__).resolve().parents[1] / "data" / "prices.toml"


class SeedData(unittest.TestCase):
    def test_seed_prices_validate(self):
        if not SEED.exists():
            self.skipTest("data/prices.toml not created yet (session 3)")
        rows = load_price_table(SEED)
        self.assertTrue(rows)


if __name__ == "__main__":
    unittest.main()
