'use strict';
// Tests for web/model.js, run with Node's built-in test runner: from web/, `node --test`.
// model.js is a classic script that exports its functions only when Node loads it.
//
// Where each expected value comes from:
//   - "hand-computed": worked out on paper from the formulas printed in Brief 04, section 8.1,
//     with round inputs chosen here. These are not published values.
//   - "Brief 04, section 8.2": printed in the paper's table (Server scenario, five-year
//     amortization, industrial tariff, PUE 1.2). The paper prints no TDP. Two rows (the Arc
//     Pro B60 and the MI355X) have a TDP read from the vendor's own page on 2026-11-01 and
//     reproduce every printed value, so they are golden tests. The other rows have no
//     TDP read from a vendor page yet, so the 8.2 tests check only what the printed inputs
//     support: the capital-only floor cannot exceed a printed result (to its printed
//     rounding), and p = 1 never costs less than p = u.
const test = require('node:test');
const assert = require('node:assert');
const model = require('../model.js');

function near(actual, expected, relative, message) {
  const tolerance = Math.abs(expected) * (relative === undefined ? 1e-12 : relative);
  assert.ok(Math.abs(actual - expected) <= tolerance,
    (message || 'values differ') + ': got ' + actual + ', expected ' + expected);
}

// Hand-computed case: 2 accelerators at 1,000 tokens per second each, $10,000 each, 5 years,
// 500 W TDP each, tariff $0.10 per kWh, PUE 1.2, u = 0.5.
const BASE = {
  throughputPerAccelerator: 1000,
  accelerators: 2,
  unitPrice: 10000,
  amortizationYears: 5,
  tdpWatts: 500,
  tariff: 0.10,
  pue: 1.2,
  u: 0.5,
  p: 1
};
function withInputs(changes) { return Object.assign({}, BASE, changes); }
// Inputs for ownedCostRange, which chooses p itself.
function withoutP(changes) {
  const inputs = withInputs(changes);
  delete inputs.p;
  return inputs;
}

test('exports the documented functions and constants', () => {
  assert.strictEqual(typeof model.ownedCost, 'function');
  assert.strictEqual(typeof model.ownedCostRange, 'function');
  assert.strictEqual(model.SECONDS_PER_HOUR, 3600);
  assert.strictEqual(model.HOURS_PER_YEAR, 8760);
});

test('hand-computed: each term of the section 8.1 arithmetic, p = 1', () => {
  const r = model.ownedCost(BASE);
  // 1000 x 2 x 3600 x 8760 x 0.5 = 31,536,000,000
  assert.strictEqual(r.tokensPerYear, 31536000000);
  // 10000 x 2 / 5 = 4000
  assert.strictEqual(r.capitalPerYear, 4000);
  // 500 x 2 / 1000 x 8760 x 1 = 8760
  assert.strictEqual(r.energyKWhPerYear, 8760);
  // 8760 x 0.10 x 1.2 = 1051.2
  near(r.energyCostPerYear, 1051.2, 1e-12, 'energy cost per year');
  // 1e6 x (4000 + 1051.2) / 31,536,000,000
  near(r.costPerMtok, 5051.2e6 / 31536000000, 1e-12, 'cost per million tokens');
  near(r.costPerMtok, 0.1601725, 1e-6, 'cost per million tokens, decimal form');
});

test('hand-computed: p = u halves the energy term', () => {
  const r = model.ownedCost(withInputs({ p: 0.5 }));
  assert.strictEqual(r.energyKWhPerYear, 4380);
  near(r.costPerMtok, (4000 + 4380 * 0.10 * 1.2) * 1e6 / 31536000000, 1e-12);
  near(r.costPerMtok, 0.1435, 1e-3, 'decimal form');
});

test('hand-computed: zero TDP leaves only the capital term', () => {
  const r = model.ownedCost(withInputs({ tdpWatts: 0 }));
  assert.strictEqual(r.energyKWhPerYear, 0);
  near(r.costPerMtok, 4000 * 1e6 / 31536000000, 1e-12);
});

test('every owned-hardware result is labeled a floor', () => {
  assert.strictEqual(model.ownedCost(BASE).label, 'floor');
  const range = model.ownedCostRange(withoutP({}));
  assert.strictEqual(range.pEqualsU.label, 'floor');
  assert.strictEqual(range.pEqualsOne.label, 'floor');
});

test('p can never be set below u', () => {
  assert.throws(() => model.ownedCost(withInputs({ u: 0.5, p: 0.4 })), RangeError);
  assert.throws(() => model.ownedCost(withInputs({ u: 0.24, p: 0.05 })), RangeError);
  assert.throws(() => model.ownedCost(withInputs({ u: 1, p: 0.999999 })), RangeError);
  // p equal to u, and p above u, are allowed
  assert.doesNotThrow(() => model.ownedCost(withInputs({ u: 0.5, p: 0.5 })));
  assert.doesNotThrow(() => model.ownedCost(withInputs({ u: 0.5, p: 0.75 })));
  assert.doesNotThrow(() => model.ownedCost(withInputs({ u: 0.5, p: 1 })));
});

test('p is required: a missing p is an error, not a silent p = u', () => {
  const noP = withInputs({});
  delete noP.p;
  assert.throws(() => model.ownedCost(noP), TypeError);
});

test('p above 1, and u outside (0, 1], are rejected', () => {
  assert.throws(() => model.ownedCost(withInputs({ p: 1.01 })), RangeError);
  assert.throws(() => model.ownedCost(withInputs({ u: 0, p: 1 })), RangeError);
  assert.throws(() => model.ownedCost(withInputs({ u: -0.1, p: 1 })), RangeError);
  assert.throws(() => model.ownedCost(withInputs({ u: 1.01, p: 1 })), RangeError);
});

test('inputs that are not finite numbers are rejected', () => {
  const names = ['throughputPerAccelerator', 'accelerators', 'unitPrice', 'amortizationYears',
    'tdpWatts', 'tariff', 'pue', 'u', 'p'];
  for (const name of names) {
    for (const bad of [NaN, Infinity, '1', null, undefined]) {
      assert.throws(() => model.ownedCost(withInputs({ [name]: bad })), TypeError,
        name + ' = ' + String(bad));
    }
  }
});

test('out-of-range inputs are rejected', () => {
  assert.throws(() => model.ownedCost(withInputs({ throughputPerAccelerator: 0 })), RangeError);
  assert.throws(() => model.ownedCost(withInputs({ accelerators: 0 })), RangeError);
  assert.throws(() => model.ownedCost(withInputs({ accelerators: 1.5 })), RangeError);
  assert.throws(() => model.ownedCost(withInputs({ unitPrice: -1 })), RangeError);
  assert.throws(() => model.ownedCost(withInputs({ amortizationYears: 0 })), RangeError);
  assert.throws(() => model.ownedCost(withInputs({ tdpWatts: -1 })), RangeError);
  assert.throws(() => model.ownedCost(withInputs({ tariff: -0.01 })), RangeError);
  assert.throws(() => model.ownedCost(withInputs({ pue: 0.99 })), RangeError);
  assert.doesNotThrow(() => model.ownedCost(withInputs({ pue: 1 })));
});

test('ownedCostRange returns the two columns the paper prints: p = u and p = 1', () => {
  const range = model.ownedCostRange({
    throughputPerAccelerator: 1000, accelerators: 2, unitPrice: 10000, amortizationYears: 5,
    tdpWatts: 500, tariff: 0.10, pue: 1.2, u: 0.5
  });
  assert.strictEqual(range.pEqualsU.inputs.p, 0.5);
  assert.strictEqual(range.pEqualsOne.inputs.p, 1);
  near(range.pEqualsU.costPerMtok, model.ownedCost(withInputs({ p: 0.5 })).costPerMtok);
  near(range.pEqualsOne.costPerMtok, model.ownedCost(withInputs({ p: 1 })).costPerMtok);
});

test('ownedCostRange rejects a supplied p, so the range cannot be built with p below u', () => {
  assert.throws(() => model.ownedCostRange(withInputs({ p: 0.1 })), TypeError);
});

test('at u = 1 the two columns are equal, as in every row of the section 8.2 table', () => {
  const range = model.ownedCostRange(withoutP({ u: 1 }));
  assert.strictEqual(range.pEqualsU.costPerMtok, range.pEqualsOne.costPerMtok);
});

test('property: cost with p = 1 is never below cost with p = u', () => {
  for (const u of [0.01, 0.05, 0.24, 0.5, 0.9, 1]) {
    const range = model.ownedCostRange(withoutP({ u }));
    assert.ok(range.pEqualsOne.costPerMtok >= range.pEqualsU.costPerMtok, 'u = ' + u);
  }
});

test('property: with p = 1, cost times u does not change (capital and energy both scale as 1/u)', () => {
  const full = model.ownedCost(withInputs({ u: 1, p: 1 })).costPerMtok;
  for (const u of [0.05, 0.24, 0.5]) {
    near(model.ownedCost(withInputs({ u, p: 1 })).costPerMtok * u, full, 1e-12, 'u = ' + u);
  }
});

test('property: with p = u, energy cost per token does not depend on u', () => {
  const energyOnly = (u) => model.ownedCost(withInputs({ unitPrice: 0, u, p: u })).costPerMtok;
  near(energyOnly(0.05), energyOnly(1), 1e-12);
  near(energyOnly(0.24), energyOnly(1), 1e-12);
});

// Brief 04, section 8.2 (copied from the PDF in session s07). Server scenario, five-year
// amortization, industrial tariff, PUE 1.2. Dollars per million output tokens, "p = u / p = 1"
// at u = 0.05, 0.24, and 1.00. Unit prices are the ones the paper prints in section 8.5 (the
// B60 as a dated retailer listing, the other five as relay prices). tok/s is the table's.
// The table prints two decimals, so each printed value can differ from the true one by 0.005.
const SECTION_8_2 = [
  { name: 'Intel Arc Pro B60', price: 649.99, tps: 113.0,
    printed: { 0.05: [0.78, 1.81], 0.24: [0.21, 0.38], 1: [0.09, 0.09] } },
  { name: 'NVIDIA RTX PRO 6000 SE', price: 13250, tps: 1782.4,
    printed: { 0.05: [0.95, 1.15], 0.24: [0.21, 0.24], 1: [0.06, 0.06] } },
  { name: 'AMD Instinct MI355X', price: 30000, tps: 10267.0,
    printed: { 0.05: [0.37, 0.45], 0.24: [0.08, 0.09], 1: [0.02, 0.02] } },
  { name: 'NVIDIA H200-SXM-141GB', price: 30000, tps: 3012.9,
    printed: { 0.05: [1.27, 1.40], 0.24: [0.27, 0.29], 1: [0.07, 0.07] } },
  { name: 'NVIDIA GB200', price: 37000, tps: 12489.1,
    printed: { 0.05: [0.38, 0.43], 0.24: [0.08, 0.09], 1: [0.02, 0.02] } },
  { name: 'NVIDIA GB300', price: 43000, tps: 15232.9,
    printed: { 0.05: [0.36, 0.41], 0.24: [0.08, 0.09], 1: [0.02, 0.02] } }
];
const ROUNDING = 0.005;

test('Brief 04 s8.2: the capital-only floor never exceeds a printed result', () => {
  for (const row of SECTION_8_2) {
    for (const u of [0.05, 0.24, 1]) {
      const capitalOnly = model.ownedCost({
        throughputPerAccelerator: row.tps, accelerators: 1, unitPrice: row.price,
        amortizationYears: 5, tdpWatts: 0, tariff: 0.0917, pue: 1.2, u, p: u
      }).costPerMtok;
      const printed = row.printed[u];
      assert.ok(capitalOnly <= printed[0] + ROUNDING + 1e-12,
        row.name + ' u=' + u + ': capital only ' + capitalOnly + ' > printed ' + printed[0]);
      assert.ok(capitalOnly <= printed[1] + ROUNDING + 1e-12,
        row.name + ' u=' + u + ': capital only ' + capitalOnly + ' > printed ' + printed[1]);
    }
  }
});

test('Brief 04 s8.2: printed p = 1 is never below printed p = u, and equal at u = 1', () => {
  for (const row of SECTION_8_2) {
    for (const u of [0.05, 0.24, 1]) {
      const printed = row.printed[u];
      assert.ok(printed[1] >= printed[0], row.name + ' u=' + u);
    }
    assert.strictEqual(row.printed[1][0], row.printed[1][1], row.name + ' at u = 1');
  }
});

// Golden rows from Brief 04, section 8.2: the two rows whose TDP was read from the vendor's own
// page on 2026-11-01. Inputs: unit price and tokens per second as printed (section 8.5 and the
// 8.2 table), five-year amortization, tariff $0.0917 per kWh (the paper's industrial figure,
// section 5.2), PUE 1.2, one accelerator (the count cancels in cost per token).
//   Intel Arc Pro B60: 200 W, the upper end of "120-200W Total Board Power" in Intel's Arc Pro B60
//     datasheet (specifications "may vary by provider"); board-partner pages state 200 W.
//   AMD Instinct MI355X: 1400 W, "Typical Board Power (TBP) 1400W" on AMD's product page.
// The printed values carry two decimals, so each computed value must be within 0.005 of them.
const SECTION_8_2_GOLDEN = [
  { name: 'Intel Arc Pro B60', unitPrice: 649.99, tps: 113.0, tdpWatts: 200 },
  { name: 'AMD Instinct MI355X', unitPrice: 30000, tps: 10267.0, tdpWatts: 1400 }
];

test('Brief 04 s8.2 golden rows: B60 and MI355X reproduce all six printed pairs', () => {
  for (const g of SECTION_8_2_GOLDEN) {
    const row = SECTION_8_2.find((r) => r.name === g.name);
    assert.ok(row, g.name + ' is in the section 8.2 data');
    assert.strictEqual(row.price, g.unitPrice);
    assert.strictEqual(row.tps, g.tps);
    for (const u of [0.05, 0.24, 1]) {
      const range = model.ownedCostRange({
        throughputPerAccelerator: g.tps, accelerators: 1, unitPrice: g.unitPrice,
        amortizationYears: 5, tdpWatts: g.tdpWatts, tariff: 0.0917, pue: 1.2, u
      });
      const printed = row.printed[u];
      assert.ok(Math.abs(range.pEqualsU.costPerMtok - printed[0]) <= ROUNDING + 1e-9,
        g.name + ' u=' + u + ' p=u: computed ' + range.pEqualsU.costPerMtok + ', printed ' + printed[0]);
      assert.ok(Math.abs(range.pEqualsOne.costPerMtok - printed[1]) <= ROUNDING + 1e-9,
        g.name + ' u=' + u + ' p=1: computed ' + range.pEqualsOne.costPerMtok + ', printed ' + printed[1]);
    }
  }
});

test('Brief 04 s8.2 golden rows: a wrong TDP is not accepted (the check can fail)', () => {
  const g = SECTION_8_2_GOLDEN[0];
  const row = SECTION_8_2.find((r) => r.name === g.name);
  const range = model.ownedCostRange({
    throughputPerAccelerator: g.tps, accelerators: 1, unitPrice: g.unitPrice,
    amortizationYears: 5, tdpWatts: 400, tariff: 0.0917, pue: 1.2, u: 0.05
  });
  assert.ok(Math.abs(range.pEqualsOne.costPerMtok - row.printed[0.05][1]) > ROUNDING);
});

test('the accelerator count cancels: 1 and 8 accelerators give the same cost per token', () => {
  const one = model.ownedCost(withInputs({ accelerators: 1 })).costPerMtok;
  const eight = model.ownedCost(withInputs({ accelerators: 8 })).costPerMtok;
  near(eight, one, 1e-12);
});

// ---------------------------------------------------------------------------------------------
// Rental routes and break-even (Part 1.2, session s08).
//
// Brief 04, section 9: a metered offer is billed for the hours used, so its cost per token does
// not depend on utilization; a committed offer is billed for the term whether used or not, so it
// scales with 1 / u like owned capital. They are separate functions and must never be merged.
//   metered:   cost_per_Mtok = 1e6 x hourly_rate / (throughput x 3600)
//   committed: cost_per_Mtok = 1e6 x hourly_rate / (throughput x 3600 x u)
// Hourly rates are per accelerator. Throughput is the saturated-batch MLPerf figure, so these
// results inherit the arrival-rate problem the paper names in sections 8.3 and 9.2.

// Brief 04, section 9.2: metered route, Server scenario, "flat at every utilization". Dollars per
// hour (printed) and dollars per million output tokens (printed, three decimals). Tokens per
// second per accelerator are the ones printed in section 8.2 (the H200 and GB300 rows of the
// table, and the B200 and B300 in the text under it).
const TPS = { B200: 10930.5, H200: 3012.9, B300: 13831.9, GB300: 15232.9 };
const SECTION_9_2 = [
  { offer: 'Preemptible', acc: 'B200', rate: 4.09, printed: 0.104 },
  { offer: 'On-demand', acc: 'B200', rate: 8.19, printed: 0.208 },
  { offer: 'Dedicated on-demand', acc: 'B200', rate: 8.99, printed: 0.228 },
  { offer: 'Dedicated on-demand', acc: 'B200', rate: 9.98, printed: 0.254 },
  { offer: 'Preemptible', acc: 'H200', rate: 2.99, printed: 0.276 },
  { offer: 'On-demand', acc: 'B300', rate: 15.00, printed: 0.301 },
  { offer: 'On-demand', acc: 'B200', rate: 13.00, printed: 0.330 },
  { offer: 'On-demand', acc: 'GB300', rate: 20.00, printed: 0.365 },
  { offer: 'On-demand', acc: 'H200', rate: 5.99, printed: 0.552 },
  { offer: 'On-demand', acc: 'H200', rate: 8.00, printed: 0.738 }
];
const ROUNDING_3 = 0.0005;

test('exports the rental and break-even functions', () => {
  for (const name of ['meteredCost', 'committedCost', 'committedBreakEven', 'ownedBreakEven']) {
    assert.strictEqual(typeof model[name], 'function', name);
  }
});

test('Brief 04 s9.2: all ten metered rows reproduce the printed cost per million tokens', () => {
  for (const row of SECTION_9_2) {
    const cost = model.meteredCost({ hourlyRate: row.rate, throughputPerAccelerator: TPS[row.acc] });
    assert.ok(Math.abs(cost.costPerMtok - row.printed) <= ROUNDING_3 + 1e-9,
      row.offer + ' ' + row.acc + ' $' + row.rate + ': computed ' + cost.costPerMtok +
      ', printed ' + row.printed);
    assert.strictEqual(cost.label, 'metered');
  }
});

test('hand-computed: metered cost is rate x 1e6 / (throughput x 3600)', () => {
  // $3.60 per hour at 1,000 tokens per second: 3.6 / 3,600,000 tokens = $1 per million
  near(model.meteredCost({ hourlyRate: 3.6, throughputPerAccelerator: 1000 }).costPerMtok, 1, 1e-12);
});

test('metered cost does not depend on utilization, even if a u is passed', () => {
  const base = { hourlyRate: 8.19, throughputPerAccelerator: TPS.B200 };
  const reference = model.meteredCost(base).costPerMtok;
  for (const u of [0.01, 0.05, 0.24, 0.5, 1]) {
    assert.strictEqual(model.meteredCost(Object.assign({ u }, base)).costPerMtok, reference);
  }
});

test('hand-computed: committed cost is the metered cost divided by u', () => {
  const inputs = { hourlyRate: 3.6, throughputPerAccelerator: 1000 };
  near(model.committedCost(Object.assign({ u: 1 }, inputs)).costPerMtok, 1, 1e-12);
  near(model.committedCost(Object.assign({ u: 0.5 }, inputs)).costPerMtok, 2, 1e-12);
  near(model.committedCost(Object.assign({ u: 0.25 }, inputs)).costPerMtok, 4, 1e-12);
  assert.strictEqual(model.committedCost(Object.assign({ u: 0.5 }, inputs)).label, 'committed');
});

test('committed cost at u = 1 equals metered cost at the same rate', () => {
  for (const row of SECTION_9_2) {
    const inputs = { hourlyRate: row.rate, throughputPerAccelerator: TPS[row.acc] };
    near(model.committedCost(Object.assign({ u: 1 }, inputs)).costPerMtok,
      model.meteredCost(inputs).costPerMtok, 1e-12);
  }
});

test('committed cost requires u in (0, 1]', () => {
  const inputs = { hourlyRate: 8.19, throughputPerAccelerator: TPS.B200 };
  assert.throws(() => model.committedCost(inputs), TypeError);
  assert.throws(() => model.committedCost(Object.assign({ u: 0 }, inputs)), RangeError);
  assert.throws(() => model.committedCost(Object.assign({ u: 1.01 }, inputs)), RangeError);
  assert.throws(() => model.committedCost(Object.assign({ u: NaN }, inputs)), TypeError);
});

test('rental inputs are validated', () => {
  const ok = { u: 0.5, hourlyRate: 8.19, throughputPerAccelerator: TPS.B200 };
  for (const fn of [model.meteredCost, model.committedCost]) {
    assert.doesNotThrow(() => fn(ok));
    assert.throws(() => fn(Object.assign({}, ok, { hourlyRate: -1 })), RangeError);
    assert.throws(() => fn(Object.assign({}, ok, { throughputPerAccelerator: 0 })), RangeError);
    assert.throws(() => fn(Object.assign({}, ok, { hourlyRate: '8' })), TypeError);
    assert.throws(() => fn(Object.assign({}, ok, { throughputPerAccelerator: Infinity })), TypeError);
    assert.throws(() => fn(null), TypeError);
  }
});

// Brief 04, section 9.3: committed route, cheapest like-for-like API $0.318 per million output
// tokens (printed in sections 8.3 and 9.2 to three decimals, so a break-even computed from it
// can differ from the printed figure by about 0.0016 x the figure; a tolerance of 0.001 is used).
const API_PRICE = 0.318;
const BE_TOLERANCE = 0.001;

test('Brief 04 s9.3: committed B200 break-even is 0.655 on demand and 0.543 on the longest term', () => {
  const onDemand = model.committedBreakEven({
    hourlyRate: 8.19, throughputPerAccelerator: TPS.B200, apiPricePerMtok: API_PRICE
  });
  const longest = model.committedBreakEven({
    hourlyRate: 6.79, throughputPerAccelerator: TPS.B200, apiPricePerMtok: API_PRICE
  });
  assert.ok(Math.abs(onDemand.utilization - 0.655) <= BE_TOLERANCE, 'on demand: ' + onDemand.utilization);
  assert.ok(Math.abs(longest.utilization - 0.543) <= BE_TOLERANCE, 'longest term: ' + longest.utilization);
  assert.strictEqual(onDemand.reachable, true);
  assert.strictEqual(longest.reachable, true);
  assert.ok(longest.utilization < onDemand.utilization);
});

test('Brief 04 s9.3: committed H200 never breaks even, 1.16x above the API at the deepest discount', () => {
  // Printed H200 hourly rates: on demand 5.99, 7-30 days 4.99, 31-90 days 4.15, 91-180 days 3.99.
  for (const rate of [5.99, 4.99, 4.15, 3.99]) {
    const be = model.committedBreakEven({
      hourlyRate: rate, throughputPerAccelerator: TPS.H200, apiPricePerMtok: API_PRICE
    });
    assert.ok(be.utilization > 1, 'rate ' + rate + ': ' + be.utilization);
    assert.strictEqual(be.reachable, false, 'rate ' + rate);
  }
  const deepest = model.committedBreakEven({
    hourlyRate: 3.99, throughputPerAccelerator: TPS.H200, apiPricePerMtok: API_PRICE
  });
  // The paper prints "1.16x"; the break-even utilization is also the ratio of cost at u = 1 to
  // the API price.
  assert.ok(Math.abs(deepest.utilization - 1.16) <= 0.005, 'deepest: ' + deepest.utilization);
});

test('committed break-even round trip: cost at the break-even utilization equals the API price', () => {
  const inputs = { hourlyRate: 8.19, throughputPerAccelerator: TPS.B200 };
  const be = model.committedBreakEven(Object.assign({ apiPricePerMtok: API_PRICE }, inputs));
  near(model.committedCost(Object.assign({ u: be.utilization }, inputs)).costPerMtok, API_PRICE, 1e-12);
});

test('break-even inputs are validated', () => {
  const ok = { hourlyRate: 8.19, throughputPerAccelerator: TPS.B200, apiPricePerMtok: API_PRICE };
  assert.throws(() => model.committedBreakEven(Object.assign({}, ok, { apiPricePerMtok: 0 })), RangeError);
  assert.throws(() => model.committedBreakEven(Object.assign({}, ok, { apiPricePerMtok: -1 })), RangeError);
  assert.throws(() => model.committedBreakEven(Object.assign({}, ok, { apiPricePerMtok: '0.3' })), TypeError);
  assert.throws(() => model.committedBreakEven(Object.assign({}, ok, { hourlyRate: -1 })), RangeError);
});

// Owned-hardware break-even. Not published in Brief 04, so checked by hand and by round trip.
// Let C be the capital cost and E the energy cost, in dollars per million tokens, at u = 1 and
// p = 1. Then:
//   always powered (p = 1):                cost(u) = (C + E) / u, so u* = (C + E) / api
//   powered only while producing (p = u):  cost(u) = C / u + E,   so u* = C / (api - E)
// and the second has no break-even when the API price is at or below E.
const OWNED_BASE = {
  throughputPerAccelerator: 1000, accelerators: 2, unitPrice: 10000, amortizationYears: 5,
  tdpWatts: 500, tariff: 0.10, pue: 1.2
};
// At u = 1 the hand case has 6.3072e10 tokens per year, capital $4000, energy cost $1051.2.
const OWNED_C = 4000e6 / 6.3072e10;
const OWNED_E = 1051.2e6 / 6.3072e10;

test('hand-computed owned break-even, always powered (p = 1)', () => {
  const be = model.ownedBreakEven(Object.assign({ apiPricePerMtok: 0.5, powered: 'always' }, OWNED_BASE));
  near(be.utilization, (OWNED_C + OWNED_E) / 0.5, 1e-12);
  near(be.utilization, 0.1601725, 1e-6, 'decimal form');
  assert.strictEqual(be.reachable, true);
  assert.strictEqual(be.label, 'floor');
});

test('hand-computed owned break-even, powered only while producing (p = u)', () => {
  const be = model.ownedBreakEven(Object.assign({ apiPricePerMtok: 0.5, powered: 'equalsU' }, OWNED_BASE));
  near(be.utilization, OWNED_C / (0.5 - OWNED_E), 1e-12);
  assert.strictEqual(be.reachable, true);
});

test('owned break-even round trip, both power assumptions, several API prices', () => {
  for (const powered of ['always', 'equalsU']) {
    for (const api of [0.2, 0.35, 0.5, 1, 5]) {
      const be = model.ownedBreakEven(Object.assign({ apiPricePerMtok: api, powered }, OWNED_BASE));
      if (!be.reachable) { continue; }
      const p = powered === 'always' ? 1 : be.utilization;
      const cost = model.ownedCost(Object.assign({ u: be.utilization, p }, OWNED_BASE)).costPerMtok;
      near(cost, api, 1e-9, powered + ' at API ' + api);
    }
  }
});

test('owned break-even: always-powered is never easier than powered-only-while-producing', () => {
  for (const api of [0.2, 0.35, 0.5, 1, 5]) {
    const always = model.ownedBreakEven(Object.assign({ apiPricePerMtok: api, powered: 'always' }, OWNED_BASE));
    const onlyU = model.ownedBreakEven(Object.assign({ apiPricePerMtok: api, powered: 'equalsU' }, OWNED_BASE));
    if (onlyU.utilization === null) { continue; }
    assert.ok(always.utilization >= onlyU.utilization - 1e-12, 'api ' + api);
  }
});

test('owned break-even is unreachable when the API price is at or below the energy cost per token', () => {
  for (const api of [OWNED_E, OWNED_E / 2]) {
    const be = model.ownedBreakEven(Object.assign({ apiPricePerMtok: api, powered: 'equalsU' }, OWNED_BASE));
    assert.strictEqual(be.utilization, null);
    assert.strictEqual(be.reachable, false);
  }
});

test('owned break-even above 1 is reported but not reachable', () => {
  const be = model.ownedBreakEven(Object.assign({ apiPricePerMtok: 0.05, powered: 'always' }, OWNED_BASE));
  assert.ok(be.utilization > 1);
  assert.strictEqual(be.reachable, false);
});

test('owned break-even needs an explicit powered assumption and a valid API price', () => {
  assert.throws(() => model.ownedBreakEven(Object.assign({ apiPricePerMtok: 0.5 }, OWNED_BASE)), TypeError);
  assert.throws(() => model.ownedBreakEven(
    Object.assign({ apiPricePerMtok: 0.5, powered: 'sometimes' }, OWNED_BASE)), RangeError);
  assert.throws(() => model.ownedBreakEven(
    Object.assign({ apiPricePerMtok: 0, powered: 'always' }, OWNED_BASE)), RangeError);
  assert.throws(() => model.ownedBreakEven(
    Object.assign({ apiPricePerMtok: 0.5, powered: 'always', u: 0.5 }, OWNED_BASE)), TypeError);
});

// ---------------------------------------------------------------------------------------------
// Sensitivity strip (Part 1.2, session s09): the owned-hardware cost, p = u and p = 1, as one of
// PUE, tariff, or amortization years varies and everything else is held. Not a published
// result, so checked by hand and against ownedCostRange.
const STRIP_BASE = {
  throughputPerAccelerator: 1000, accelerators: 2, unitPrice: 10000, amortizationYears: 5,
  tdpWatts: 500, tariff: 0.10, pue: 1.2, u: 0.5
};

test('sensitivityStrip is exported', () => {
  assert.strictEqual(typeof model.sensitivityStrip, 'function');
});

test('sensitivityStrip returns one row per value, in order, matching ownedCostRange', () => {
  const rows = model.sensitivityStrip(STRIP_BASE, 'pue', [1.2, 1.44, 1.54]);
  assert.deepStrictEqual(rows.map((r) => r.value), [1.2, 1.44, 1.54]);
  for (const row of rows) {
    const expected = model.ownedCostRange(Object.assign({}, STRIP_BASE, { pue: row.value }));
    assert.strictEqual(row.pEqualsU.costPerMtok, expected.pEqualsU.costPerMtok);
    assert.strictEqual(row.pEqualsOne.costPerMtok, expected.pEqualsOne.costPerMtok);
    assert.strictEqual(row.axis, 'pue');
  }
});

test('hand-computed strip: tariff 0.10 and 0.20 at u = 0.5', () => {
  // tokens per year 3.1536e10, capital 4000. Energy at p = 1: 8760 kWh; at p = u: 4380 kWh.
  const rows = model.sensitivityStrip(STRIP_BASE, 'tariff', [0.10, 0.20]);
  near(rows[0].pEqualsOne.costPerMtok, (4000 + 8760 * 0.10 * 1.2) * 1e6 / 3.1536e10, 1e-12);
  near(rows[1].pEqualsOne.costPerMtok, (4000 + 8760 * 0.20 * 1.2) * 1e6 / 3.1536e10, 1e-12);
  near(rows[1].pEqualsU.costPerMtok, (4000 + 4380 * 0.20 * 1.2) * 1e6 / 3.1536e10, 1e-12);
});

test('hand-computed strip: amortization 5 and 10 years halves the capital term', () => {
  const rows = model.sensitivityStrip(STRIP_BASE, 'amortizationYears', [5, 10]);
  near(rows[0].pEqualsU.costPerMtok, (4000 + 4380 * 0.10 * 1.2) * 1e6 / 3.1536e10, 1e-12);
  near(rows[1].pEqualsU.costPerMtok, (2000 + 4380 * 0.10 * 1.2) * 1e6 / 3.1536e10, 1e-12);
});

test('strip direction: higher PUE or tariff raises cost; longer amortization lowers it', () => {
  const up = (axis, values) => {
    const rows = model.sensitivityStrip(STRIP_BASE, axis, values);
    return rows.map((r) => r.pEqualsOne.costPerMtok);
  };
  const pue = up('pue', [1.0, 1.2, 1.54, 2.0]);
  const tariff = up('tariff', [0.05, 0.0917, 0.15]);
  const years = up('amortizationYears', [3, 5, 7]);
  for (let i = 1; i < pue.length; i += 1) { assert.ok(pue[i] > pue[i - 1], 'pue ' + i); }
  for (let i = 1; i < tariff.length; i += 1) { assert.ok(tariff[i] > tariff[i - 1], 'tariff ' + i); }
  for (let i = 1; i < years.length; i += 1) { assert.ok(years[i] < years[i - 1], 'years ' + i); }
});

test('strip rows keep the floor label and p never falls below u', () => {
  const rows = model.sensitivityStrip(STRIP_BASE, 'pue', [1.2, 1.5]);
  for (const row of rows) {
    assert.strictEqual(row.pEqualsU.label, 'floor');
    assert.strictEqual(row.pEqualsU.inputs.p, STRIP_BASE.u);
    assert.strictEqual(row.pEqualsOne.inputs.p, 1);
  }
});

test('sensitivityStrip rejects an unknown axis, an empty list, and a supplied p', () => {
  assert.throws(() => model.sensitivityStrip(STRIP_BASE, 'u', [0.5]), RangeError);
  assert.throws(() => model.sensitivityStrip(STRIP_BASE, 'unitPrice', [1]), RangeError);
  assert.throws(() => model.sensitivityStrip(STRIP_BASE, 'pue', []), RangeError);
  assert.throws(() => model.sensitivityStrip(STRIP_BASE, 'pue', 1.2), TypeError);
  assert.throws(() => model.sensitivityStrip(Object.assign({ p: 1 }, STRIP_BASE), 'pue', [1.2]), TypeError);
});

test('sensitivityStrip lets the model reject a bad swept value', () => {
  assert.throws(() => model.sensitivityStrip(STRIP_BASE, 'pue', [1.2, 0.9]), RangeError);
  assert.throws(() => model.sensitivityStrip(STRIP_BASE, 'tariff', [-0.01]), RangeError);
  assert.throws(() => model.sensitivityStrip(STRIP_BASE, 'amortizationYears', [0]), RangeError);
  assert.throws(() => model.sensitivityStrip(STRIP_BASE, 'pue', ['1.2']), TypeError);
});
