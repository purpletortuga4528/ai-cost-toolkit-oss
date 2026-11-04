'use strict';
// Tests for web/presets.js, run with `node --test` from web/.
// The stale rule matches Part 1.1: a value is stale when today minus as_of, in days, is greater
// than shelf_life_days; a value exactly at its shelf life is not stale. A preset with a null
// shelf life is a scenario value (a setting used to reproduce a published result), not a
// market figure, so it has no stale clock and the page labels it as a scenario.
const test = require('node:test');
const assert = require('node:assert');
const presets = require('../presets.js');
const presetStatus = presets.presetStatus;

const TODAY = '2026-11-02';
// The day the shipped presets were last read at their publishers. A shipped preset may not be
// dated after it, and none may be stale on it.
const SHIPPED_DAY = '2026-11-04';

function sample(changes) {
  return Object.assign({
    id: 'sample', label: 'Sample', value: 1, kind: 'published',
    source_url: 'https://example.org/page', as_of: '2026-11-01', tier: 'A',
    shelf_life_days: 30, note: ''
  }, changes);
}

test('exports the documented names', () => {
  assert.strictEqual(typeof presets.PRESETS, 'object');
  assert.strictEqual(typeof presets.daysBetween, 'function');
  assert.strictEqual(typeof presets.presetStatus, 'function');
  assert.strictEqual(typeof presets.validatePreset, 'function');
});

test('daysBetween counts whole calendar days', () => {
  assert.strictEqual(presets.daysBetween('2026-11-01', '2026-11-01'), 0);
  assert.strictEqual(presets.daysBetween('2026-11-01', '2026-11-02'), 1);
  assert.strictEqual(presets.daysBetween('2026-10-31', '2026-11-01'), 1);
  assert.strictEqual(presets.daysBetween('2026-02-28', '2026-03-01'), 1);
  assert.strictEqual(presets.daysBetween('2028-02-28', '2028-03-01'), 2, 'leap year');
  assert.strictEqual(presets.daysBetween('2026-01-01', '2027-01-01'), 365);
  assert.strictEqual(presets.daysBetween('2026-11-02', '2026-11-01'), -1);
});

test('daysBetween rejects text that is not a calendar date', () => {
  assert.throws(() => presets.daysBetween('2026-13-01', '2026-11-01'), RangeError);
  assert.throws(() => presets.daysBetween('2026-02-30', '2026-11-01'), RangeError);
  assert.throws(() => presets.daysBetween('11/01/2026', '2026-11-01'), RangeError);
  assert.throws(() => presets.daysBetween('', '2026-11-01'), RangeError);
  assert.throws(() => presets.daysBetween(20261101, '2026-11-01'), TypeError);
});

test('stale rule: exactly at the shelf life is not stale, one day past is', () => {
  const p = sample({ as_of: '2026-10-03', shelf_life_days: 30 });
  assert.strictEqual(presets.presetStatus(p, '2026-11-01').ageDays, 29);
  assert.strictEqual(presets.presetStatus(p, '2026-11-01').stale, false);
  assert.strictEqual(presets.presetStatus(p, '2026-11-02').ageDays, 30);
  assert.strictEqual(presets.presetStatus(p, '2026-11-02').stale, false);
  assert.strictEqual(presets.presetStatus(p, '2026-11-03').ageDays, 31);
  assert.strictEqual(presets.presetStatus(p, '2026-11-03').stale, true);
});

test('a scenario preset (null shelf life) is never stale and says so', () => {
  const p = sample({ kind: 'scenario', shelf_life_days: null, as_of: '2020-01-01' });
  const s = presets.presetStatus(p, TODAY);
  assert.strictEqual(s.stale, false);
  assert.strictEqual(s.scenario, true);
});

test('a scenario preset is never stale even if a shelf life is given', () => {
  const p = sample({ kind: 'scenario', shelf_life_days: 10, as_of: '2020-01-01' });
  const s = presetStatus(p, TODAY);
  assert.strictEqual(s.stale, false);
  assert.strictEqual(s.scenario, true);
});

test('status reports age and shelf life for a published preset', () => {
  const s = presets.presetStatus(sample(), TODAY);
  assert.strictEqual(s.ageDays, 1);
  assert.strictEqual(s.shelfLifeDays, 30);
  assert.strictEqual(s.scenario, false);
  assert.strictEqual(s.future, false);
});

test('an as-of date after today is reported as future, not as fresh', () => {
  const s = presets.presetStatus(sample({ as_of: '2026-11-03' }), TODAY);
  assert.strictEqual(s.future, true);
});

test('validatePreset accepts a complete preset', () => {
  assert.deepStrictEqual(presets.validatePreset(sample(), TODAY), []);
});

test('validatePreset reports every missing or bad provenance field, all together', () => {
  const problems = presets.validatePreset(sample({
    source_url: '', as_of: '2026-11-09', tier: 'X', shelf_life_days: 0, value: NaN
  }), TODAY);
  assert.ok(problems.some((m) => /source_url/.test(m)), problems.join('; '));
  assert.ok(problems.some((m) => /as_of/.test(m)), problems.join('; '));
  assert.ok(problems.some((m) => /tier/.test(m)), problems.join('; '));
  assert.ok(problems.some((m) => /shelf_life_days/.test(m)), problems.join('; '));
  assert.ok(problems.some((m) => /value/.test(m)), problems.join('; '));
});

test('validatePreset: tier must be A, B, or C; tier X is not shipped', () => {
  for (const tier of ['A', 'B', 'C']) {
    assert.deepStrictEqual(presets.validatePreset(sample({ tier }), TODAY), []);
  }
  for (const tier of ['X', 'a', '', undefined, null, 'D']) {
    assert.ok(presets.validatePreset(sample({ tier }), TODAY).length > 0, String(tier));
  }
});

test('validatePreset: source_url must be http or https', () => {
  assert.ok(presets.validatePreset(sample({ source_url: 'ftp://x' }), TODAY).length > 0);
  assert.ok(presets.validatePreset(sample({ source_url: 'javascript:alert(1)' }), TODAY).length > 0);
  assert.deepStrictEqual(presets.validatePreset(sample({ source_url: 'http://example.org/x' }), TODAY), []);
});

test('validatePreset: a published preset needs a positive shelf life; a scenario may use null', () => {
  assert.ok(presets.validatePreset(sample({ shelf_life_days: null }), TODAY).length > 0);
  assert.ok(presets.validatePreset(sample({ shelf_life_days: -1 }), TODAY).length > 0);
  assert.ok(presets.validatePreset(sample({ shelf_life_days: 1.5 }), TODAY).length > 0);
  assert.deepStrictEqual(
    presets.validatePreset(sample({ kind: 'scenario', shelf_life_days: null }), TODAY), []);
  assert.ok(presets.validatePreset(sample({ kind: 'other' }), TODAY).length > 0);
});

test('every shipped preset carries a source URL, an as-of date, a tier, and a shelf life rule', () => {
  let count = 0;
  for (const group of Object.keys(presets.PRESETS)) {
    for (const p of presets.PRESETS[group]) {
      count += 1;
      assert.deepStrictEqual(presets.validatePreset(p, SHIPPED_DAY), [], group + '/' + p.id);
    }
  }
  assert.strictEqual(presets.PRESETS.tariff.length, 2);
  assert.strictEqual(presets.PRESETS.pue.length, 6);
  assert.strictEqual(count, 8);
});

test('shipped presets are not stale on their check day, and have unique ids per group', () => {
  for (const group of Object.keys(presets.PRESETS)) {
    const ids = new Set();
    for (const p of presets.PRESETS[group]) {
      assert.ok(!ids.has(p.id), 'duplicate id ' + p.id);
      ids.add(p.id);
      assert.strictEqual(presets.presetStatus(p, SHIPPED_DAY).stale, false, group + '/' + p.id);
    }
  }
});

test('tariff presets are dollars per kWh and match the values read from the sources', () => {
  const byId = {};
  presets.PRESETS.tariff.forEach((p) => { byId[p.id] = p; });
  // EIA Electric Power Monthly, Table 5.6.A, industrial sector, U.S. Total, August 2026
  // (preliminary), re-read at the page on 2026-11-04: 9.64 cents per kWh.
  assert.strictEqual(byId['eia-industrial-2026-08'].value, 0.0964);
  assert.strictEqual(byId['eia-industrial-2026-08'].kind, 'published');
  assert.strictEqual(byId['eia-industrial-2026-08'].shelf_life_days, 35);
  assert.strictEqual(byId['eia-industrial-2026-08'].tier, 'A');
  // Brief 04 section 5.2: 9.17 cents per kWh industrial, June 2026 data. A reproduction value.
  // Read on 2026-11-04 in EIA's own August 2026 issue (archive), Table 5.6.A, U.S. Total,
  // Industrial, June 2026: 9.17 (preliminary at that time).
  assert.strictEqual(byId['brief04-industrial-2026-06'].value, 0.0917);
  assert.strictEqual(byId['brief04-industrial-2026-06'].kind, 'scenario');
  assert.strictEqual(byId['brief04-industrial-2026-06'].shelf_life_days, null);
  assert.strictEqual(byId['brief04-industrial-2026-06'].tier, 'A');
  assert.match(byId['brief04-industrial-2026-06'].source_url,
    /^https:\/\/www\.eia\.gov\/electricity\/monthly\/archive\/august2026\.zip$/);
});

test('PUE presets match the values read from the sources', () => {
  const byId = {};
  presets.PRESETS.pue.forEach((p) => { byId[p.id] = p; });
  // Brief 04 section 8.2 scenario, from the 2016 national laboratory report (LBNL-1005775),
  // Table 4, hyperscale, read in the publisher's own PDF on 2026-11-04. An assumed value.
  assert.strictEqual(byId['brief04-1.2'].value, 1.2);
  assert.strictEqual(byId['brief04-1.2'].kind, 'scenario');
  assert.strictEqual(byId['brief04-1.2'].tier, 'A');
  assert.match(byId['brief04-1.2'].source_url, /^https:\/\/eta-publications\.lbl\.gov\/sites\/default\/files\/lbnl-1005775_v2\.pdf$/);
  // Uptime Institute Global Data Center Survey 2025 (Keynote Report 180, July 2025), read in the
  // publisher's public PDF on 2026-11-04: pages 7 and 8.
  assert.strictEqual(byId['uptime-2025-average'].value, 1.54);
  assert.strictEqual(byId['uptime-2025-newer'].value, 1.48);
  assert.strictEqual(byId['uptime-2025-20mw'].value, 1.44);
  // Global Data Center Survey 2026 (Keynote Report 209, July 2026), same day: "industry
  // average" on page 7 and the respondents' largest data centers on page 8.
  assert.strictEqual(byId['uptime-2026-average'].value, 1.52);
  assert.strictEqual(byId['uptime-2026-largest'].value, 1.45);
  for (const id of ['uptime-2025-average', 'uptime-2025-newer', 'uptime-2025-20mw',
    'uptime-2026-average', 'uptime-2026-largest']) {
    assert.strictEqual(byId[id].kind, 'published', id);
    assert.strictEqual(byId[id].tier, 'A', id);
    assert.strictEqual(byId[id].shelf_life_days, 365, id);
    assert.match(byId[id].source_url, /^https:\/\/datacenter\.uptimeinstitute\.com\/rs\/711-RIA-145\/images\/.+\.pdf/, id);
  }
  assert.match(byId['uptime-2026-average'].note, /industry average/);
  assert.match(byId['uptime-2026-average'].note, /whether the two are the same measure is not\s+stated/);
  assert.match(byId['uptime-2025-average'].note, /weighted average/);
});

test('every PUE preset is at least 1, the lowest value model.js accepts', () => {
  for (const p of presets.PRESETS.pue) { assert.ok(p.value >= 1, p.id); }
});

test('sensitivity defaults list the three axes the page sweeps', () => {
  const d = presets.SENSITIVITY_DEFAULTS;
  assert.deepStrictEqual(Object.keys(d).sort(), ['amortizationYears', 'pue', 'tariff']);
  for (const axis of Object.keys(d)) {
    assert.ok(Array.isArray(d[axis].values) && d[axis].values.length >= 2, axis);
    assert.strictEqual(typeof d[axis].note, 'string', axis);
  }
  assert.deepStrictEqual(d.amortizationYears.values, [3, 5, 7]);
  assert.deepStrictEqual(d.pue.values, [1.2, 1.45, 1.52]);
  assert.deepStrictEqual(d.tariff.values, [0.0917, 0.0964]);
  assert.ok(/not sourced|illustrative/i.test(d.amortizationYears.note));
});

test('every sensitivity value for PUE and tariff is one of the shipped preset values', () => {
  const pue = presets.PRESETS.pue.map((p) => p.value);
  const tariff = presets.PRESETS.tariff.map((p) => p.value);
  presets.SENSITIVITY_DEFAULTS.pue.values.forEach((v) => assert.ok(pue.indexOf(v) !== -1, 'PUE ' + v));
  presets.SENSITIVITY_DEFAULTS.tariff.values.forEach((v) => assert.ok(tariff.indexOf(v) !== -1, 'tariff ' + v));
});
