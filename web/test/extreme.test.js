'use strict';
// Extreme inputs and the sensitivity lists (code review 1, findings 6 and 7). Run with
// `node --test` from web/.
//
// Finding 6: a result that is not a finite number, or a year with no tokens in it, is refused
// with a RangeError so the page shows an error. Before, throughput 1e300 on 1e10 accelerators
// gave Infinity tokens per year and a cost of $0, and throughput 1e-320 gave NaN or Infinity.
// Finding 7: a sensitivity list holds at most 20 values.
const test = require('node:test');
const assert = require('node:assert');
const model = require('../model.js');

const BASE = {
  throughputPerAccelerator: 1000, accelerators: 2, unitPrice: 10000, amortizationYears: 5,
  tdpWatts: 500, tariff: 0.10, pue: 1.2, u: 0.5, p: 1
};
function withInputs(changes) { return Object.assign({}, BASE, changes); }
function withoutP(changes) {
  const inputs = withInputs(changes);
  delete inputs.p;
  return inputs;
}
const STRIP_BASE = withoutP({});

// ---- extreme but finite inputs ---------------------------------------------------------------

test('owned cost refuses inputs whose tokens per year overflows, instead of reporting $0', () => {
  const huge = withInputs({ throughputPerAccelerator: 1e300, accelerators: 1e10 });
  assert.throws(() => model.ownedCost(huge), (e) => e instanceof RangeError && /tokens per year/.test(e.message));
});

test('owned cost refuses inputs whose tokens per year is not above 0', () => {
  const none = withInputs({ throughputPerAccelerator: 1e-300, u: 1e-300, unitPrice: 0, tdpWatts: 0 });
  assert.throws(() => model.ownedCost(none), (e) => e instanceof RangeError && /tokens per year/.test(e.message));
});

test('owned cost refuses a cost per million tokens that is not finite', () => {
  assert.throws(() => model.ownedCost(withInputs({ throughputPerAccelerator: 1e-320 })),
    (e) => e instanceof RangeError && /too large or too small/.test(e.message));
  assert.throws(() => model.ownedCost(withInputs({ unitPrice: 1e308, accelerators: 1e10 })), RangeError);
  assert.throws(() => model.ownedCost(withInputs({ tariff: 1e308 })), RangeError);
});

test('owned cost still allows a result of exactly $0 and ordinary large inputs', () => {
  const free = model.ownedCost(withInputs({ unitPrice: 0, tdpWatts: 0 }));
  assert.strictEqual(free.costPerMtok, 0);
  const big = model.ownedCost(withInputs({ throughputPerAccelerator: 1e6, accelerators: 1e5, unitPrice: 1e6 }));
  assert.ok(Number.isFinite(big.costPerMtok) && big.costPerMtok > 0);
});

test('ownedCostRange and the sensitivity strip refuse extreme inputs too', () => {
  assert.throws(() => model.ownedCostRange(withoutP({ throughputPerAccelerator: 1e300, accelerators: 1e10 })), RangeError);
  assert.throws(() => model.sensitivityStrip(STRIP_BASE, 'tariff', [0.1, 1e308]), RangeError);
  assert.throws(() => model.sensitivityStrip(STRIP_BASE, 'amortizationYears', [1e-320]), RangeError);
});

test('metered and committed rental refuse a cost that is not finite', () => {
  assert.throws(() => model.meteredCost({ hourlyRate: 1e308, throughputPerAccelerator: 1 }), RangeError);
  assert.throws(() => model.meteredCost({ hourlyRate: 1, throughputPerAccelerator: 1e-320 }), RangeError);
  assert.throws(() => model.committedCost({ hourlyRate: 1, throughputPerAccelerator: 1000, u: 1e-320 }), RangeError);
  assert.strictEqual(model.meteredCost({ hourlyRate: 0, throughputPerAccelerator: 1000 }).costPerMtok, 0);
});

test('break-even functions refuse a utilization that is not finite', () => {
  assert.throws(() => model.committedBreakEven(
    { hourlyRate: 1e308, throughputPerAccelerator: 1, apiPricePerMtok: 1e-300 }), RangeError);
  assert.throws(() => model.committedBreakEven(
    { hourlyRate: 1, throughputPerAccelerator: 1000, apiPricePerMtok: 1e-320 }), RangeError);
  const inputs = { throughputPerAccelerator: 1000, accelerators: 2, unitPrice: 10000, amortizationYears: 5,
    tdpWatts: 500, tariff: 0.10, pue: 1.2, apiPricePerMtok: 1e-320, powered: 'always' };
  assert.throws(() => model.ownedBreakEven(inputs), RangeError);
});

test('break-even results that are finite are unchanged, and null still means none', () => {
  const inputs = { throughputPerAccelerator: 1000, accelerators: 2, unitPrice: 10000, amortizationYears: 5,
    tdpWatts: 500, tariff: 0.10, pue: 1.2, apiPricePerMtok: 1e-9, powered: 'equalsU' };
  assert.strictEqual(model.ownedBreakEven(inputs).utilization, null);
  const committed = model.committedBreakEven({ hourlyRate: 2, throughputPerAccelerator: 1000, apiPricePerMtok: 1 });
  assert.ok(Number.isFinite(committed.utilization));
});

// ---- the sensitivity lists -------------------------------------------------------------------

test('MAX_SENSITIVITY_VALUES is 20 and sensitivityStrip refuses a longer list', () => {
  assert.strictEqual(model.MAX_SENSITIVITY_VALUES, 20);
  const twenty = Array.from({ length: 20 }, (_, i) => 1.2 + i / 100);
  assert.strictEqual(model.sensitivityStrip(STRIP_BASE, 'pue', twenty).length, 20);
  assert.throws(() => model.sensitivityStrip(STRIP_BASE, 'pue', twenty.concat([2])),
    (e) => e instanceof RangeError && /at most 20/.test(e.message));
});

test('parseValueList reads comma-separated numbers, trims them, and skips empty pieces', () => {
  assert.deepStrictEqual(model.parseValueList('1.2, 1.44 ,,1.54,'), { values: [1.2, 1.44, 1.54], truncated: false });
  assert.deepStrictEqual(model.parseValueList('7'), { values: [7], truncated: false });
});

test('parseValueList reports the first piece that is not a number, cut short if it is long', () => {
  assert.deepStrictEqual(model.parseValueList('1, abc, 3'), { error: '"abc" is not a number' });
  const long = model.parseValueList('x'.repeat(5000));
  assert.ok(long.error.length < 80, long.error);
  assert.ok(model.parseValueList('1, Infinity').error);
});

test('parseValueList says when nothing was entered', () => {
  for (const text of ['', '  ', ',,,', ' , ,']) {
    assert.deepStrictEqual(model.parseValueList(text), { error: 'enter at least one value' }, JSON.stringify(text));
  }
});

test('parseValueList keeps the first 20 values and says it left some out', () => {
  const twenty = Array.from({ length: 20 }, (_, i) => i + 1);
  assert.deepStrictEqual(model.parseValueList(twenty.join(',')), { values: twenty, truncated: false });
  const result = model.parseValueList(twenty.concat([21, 22]).join(', '));
  assert.deepStrictEqual(result, { values: twenty, truncated: true });
  assert.deepStrictEqual(model.parseValueList('1,2,3,4', 2), { values: [1, 2], truncated: true });
});

test('parseValueList on a huge pasted list stops early and returns at most 20 values', () => {
  const huge = Array.from({ length: 200000 }, (_, i) => i).join(',');
  const started = Date.now();
  const result = model.parseValueList(huge);
  assert.strictEqual(result.values.length, 20);
  assert.strictEqual(result.truncated, true);
  assert.ok(Date.now() - started < 1000, 'parsing a huge list should be quick');
  assert.deepStrictEqual(model.parseValueList(','.repeat(2000000)), { error: 'enter at least one value' });
});
