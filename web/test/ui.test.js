'use strict';
// Behavior of ui.js, run in Node against a small fake page (test/support/fakepage.js). Code
// review 2: R2-1 (an extreme API price must not leave a panel showing old numbers) and R2-2
// (the "only the first 20 values" note must really appear). Run with `node --test` from web/.
const test = require('node:test');
const assert = require('node:assert');
const { loadPage } = require('./support/fakepage.js');

// The hand-computed case used by model.test.js: owned inputs, then rental inputs.
const OWNED = { 'o-tps': '1000', 'o-acc': '8', 'o-price': '30000', 'o-tdp': '700', 'o-tariff': '0.0964',
  'o-pue': '1.2', 'o-u': '0.5' };
const RENTAL = { 'm-rate': '1', 'm-tps': '1000', 'c-rate': '1', 'c-tps': '1000', 'c-u': '0.5' };

function pageWithInputs() {
  const page = loadPage();
  page.fill(Object.assign({}, OWNED, RENTAL));
  return page;
}

test('the page renders every panel for ordinary inputs, with no error', () => {
  const page = pageWithInputs();
  assert.deepStrictEqual(page.uncaught, []);
  assert.match(page.text('o-results'), /Cost per million output tokens/);
  assert.match(page.text('m-results'), /\$0\.2778/);
  assert.match(page.text('c-results'), /\$0\.5556/);
  assert.match(page.text('s-results'), /PUE/);
  page.type('api-price', '1');
  assert.deepStrictEqual(page.uncaught, []);
  assert.match(page.text('o-results'), /Break-even utilization against \$1\.00/);
  assert.match(page.text('m-results'), /times the API price/);
  assert.match(page.text('c-results'), /Break-even/);
});

// ---- R2-2: the truncation note ------------------------------------------------------------

test('a sensitivity list of more than 20 values shows 20 rows and says the rest are ignored', () => {
  const page = pageWithInputs();
  const values = Array.from({ length: 25 }, (_, i) => (1.2 + i / 100).toFixed(2)).join(', ');
  page.type('s-pue', values);
  const first = page.byId('s-results').all('table')[0];
  assert.strictEqual(first.querySelectorAll('tbody tr').length, 20);
  assert.match(page.text('s-results'), /PUE: only the first 20 values are used; the rest of the list is ignored\./);
});

test('a list of 20 values or fewer shows no note', () => {
  const page = pageWithInputs();
  page.type('s-pue', Array.from({ length: 20 }, (_, i) => (1.2 + i / 100).toFixed(2)).join(', '));
  assert.strictEqual(page.byId('s-results').all('table')[0].querySelectorAll('tbody tr').length, 20);
  assert.ok(!/only the first/.test(page.text('s-results')));
});

// ---- R2-1: an extreme API price ------------------------------------------------------------

test('an API price of 1e-320 shows messages and no Infinity, NaN, or exception', () => {
  const page = pageWithInputs();
  page.type('api-price', '1e-320');
  assert.deepStrictEqual(page.uncaught.map(String), []);
  for (const id of ['o-results', 'm-results', 'c-results']) {
    assert.ok(!/Infinity|NaN/.test(page.text(id)), id + ': ' + page.text(id));
  }
  // The cost tables are still there; only the break-even parts say they cannot be calculated.
  assert.match(page.text('o-results'), /Cost per million output tokens/);
  assert.match(page.text('o-results'), /too large or too small/);
  assert.match(page.text('m-results'), /too small to compare/);
  assert.match(page.text('c-results'), /\$0\.5556/);
  assert.match(page.text('c-results'), /too large or too small/);
});

test('after an extreme API price, editing another panel still updates it (no stale panels)', () => {
  const page = pageWithInputs();
  page.type('api-price', '1e-320');
  page.type('m-rate', '2');
  page.type('c-rate', '4');
  assert.match(page.text('m-results'), /\$0\.5556/, 'metered panel shows the new rate');
  assert.match(page.text('c-results'), /\$2\.22/, 'committed panel shows the new rate');
  page.type('api-price', '1');
  assert.match(page.text('m-results'), /times the API price/);
  assert.ok(!/too large or too small/.test(page.text('c-results')));
});

test('one panel that throws does not stop the others, and says what went wrong', () => {
  const page = pageWithInputs();
  // Make the owned panel fail in a way no try/catch inside it expects: its sensitivity lists.
  page.context.parseValueList = () => { throw new Error('boom'); };
  page.type('m-rate', '2');
  assert.deepStrictEqual(page.uncaught.map(String), []);
  assert.match(page.text('o-results'), /Boom/);
  assert.match(page.text('m-results'), /\$0\.5556/, 'the metered panel still updates');
  page.type('c-rate', '4');
  assert.match(page.text('c-results'), /\$2\.22/, 'the committed panel still updates');
});

test('a panel that throws is shown as an alert, like the other errors', () => {
  const page = pageWithInputs();
  // The committed panel also asks meteredCost for the cost at u = 1, outside its own try/catch.
  page.context.meteredCost = () => { throw new Error('boom'); };
  page.type('c-rate', '3');
  assert.deepStrictEqual(page.uncaught.map(String), []);
  const box = page.byId('c-results').children[0];
  assert.strictEqual(box.className, 'error');
  assert.strictEqual(box.getAttribute('role'), 'alert');
  assert.match(page.text('c-results'), /Boom/);
});

test('when the owned panel fails, the sensitivity tables from the last good input are cleared', () => {
  const page = pageWithInputs();
  assert.match(page.text('s-results'), /p = u/, 'tables are there before the failure');
  // A result with no fields: the page reads it after its own try/catch, so it throws a TypeError.
  page.context.ownedCostRange = () => ({});
  page.type('o-tps', '2000');
  assert.deepStrictEqual(page.uncaught.map(String), []);
  assert.strictEqual(page.text('s-results'), '');
  assert.match(page.text('o-results'), /cannot read|undefined|null/i);
});

// Code review 3, R3-2: the metered panel's own safety net. The throw comes from the panel's results
// container, after the panel's own try/catch, so only the wrapper in renderAll can catch it.
test('a metered panel that throws does not stop the committed panel, and shows an alert', () => {
  const page = pageWithInputs();
  const container = page.byId('m-results');
  const original = container.appendChild.bind(container);
  let thrown = false;
  container.appendChild = (node) => {
    if (!thrown) { thrown = true; throw new Error('boom'); }
    return original(node);
  };
  page.byId('c-rate').value = '4'; // the committed panel must show this when the metered one fails
  page.type('m-rate', '2');
  assert.strictEqual(thrown, true, 'the forced failure happened');
  assert.deepStrictEqual(page.uncaught.map(String), []);
  assert.match(page.text('m-results'), /Boom/);
  assert.strictEqual(container.children[0].getAttribute('role'), 'alert');
  assert.match(page.text('c-results'), /\$2\.22/, 'the committed panel was still rendered');
});
