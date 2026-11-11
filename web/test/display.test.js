'use strict';
// Behavior of display.js, run in Node against a small fake page (no browser). It checks the
// attributes it sets on <html>, the aria-pressed state of the buttons, what it stores, and that
// the page still works when storage is missing, blocked, or holds junk. Run with `node --test`
// from web/.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const SOURCE = fs.readFileSync(path.join(__dirname, '..', 'display.js'), 'utf8');

function fakeButton(option, value) {
  const attrs = {};
  const button = {
    dataset: { displayOption: option, value: value },
    setAttribute: (k, v) => { attrs[k] = v; },
    getAttribute: (k) => (k in attrs ? attrs[k] : null),
    closest: (selector) => (selector === '[data-display-option]' ? button : null)
  };
  return button;
}

// storage: 'none' (empty), a string (saved JSON), 'throws' (every call throws), or
// 'blocked' (reading window.localStorage itself throws, as a SecurityError does).
function run(options) {
  const opts = Object.assign({ storage: 'none', moreContrast: false, writeThrows: false }, options);
  const root = { attrs: {}, setAttribute(k, v) { this.attrs[k] = v; } };
  const buttons = [];
  [['theme', 'system'], ['theme', 'light'], ['theme', 'dark'], ['contrast', 'standard'],
    ['contrast', 'high'], ['font', 'standard'], ['font', 'atkinson']]
    .forEach(([o, v]) => buttons.push(fakeButton(o, v)));
  const listeners = {};
  // lateButtons: the script runs in the head, before the buttons are parsed (document.readyState is
  // 'loading'); the buttons appear when the test calls domReady().
  let buttonsParsed = !opts.lateButtons;
  const document = {
    documentElement: root,
    readyState: opts.lateButtons ? 'loading' : 'complete',
    querySelectorAll: (selector) => (selector === '[data-display-option]' && buttonsParsed ? buttons : []),
    addEventListener: (type, fn) => { listeners[type] = fn; }
  };
  const store = {};
  const calls = { get: 0, set: 0, mediaQueries: [] };
  const localStorage = {
    getItem(key) {
      calls.get += 1;
      if (opts.storage === 'throws') { throw new Error('denied'); }
      if (key in store) { return store[key]; }
      return typeof opts.storage === 'string' && opts.storage !== 'none' ? opts.storage : null;
    },
    setItem(key, value) {
      calls.set += 1;
      if (opts.storage === 'throws' || opts.writeThrows) { throw new Error('quota'); }
      store[key] = value;
    }
  };
  const window = {
    matchMedia(query) {
      calls.mediaQueries.push(query);
      return { matches: opts.moreContrast && query === '(prefers-contrast: more)' };
    }
  };
  if (opts.storage === 'blocked') {
    Object.defineProperty(window, 'localStorage', { get() { throw new Error('SecurityError'); } });
  } else {
    window.localStorage = localStorage;
  }
  vm.runInNewContext(SOURCE, { window, document, JSON, Object, Array, String });
  const pressed = () => buttons.filter((b) => b.getAttribute('aria-pressed') === 'true')
    .map((b) => b.dataset.displayOption + '=' + b.dataset.value);
  const click = (target) => listeners.click({ target });
  const domReady = () => {
    buttonsParsed = true;
    if (listeners.DOMContentLoaded) { listeners.DOMContentLoaded(); }
  };
  return { root, buttons, store, calls, pressed, click, listeners, domReady };
}

test('first visit: system theme, standard contrast, standard font, nothing stored', () => {
  const page = run();
  assert.deepStrictEqual(page.root.attrs, { 'data-theme': 'system', 'data-font': 'standard', 'data-contrast': 'standard' });
  assert.deepStrictEqual(page.pressed().sort(), ['contrast=standard', 'font=standard', 'theme=system']);
  assert.strictEqual(page.calls.set, 0, 'nothing is written until the reader picks');
  assert.deepStrictEqual(page.store, {});
});

test('contrast follows the system more-contrast setting on a first visit', () => {
  const page = run({ moreContrast: true });
  assert.ok(page.calls.mediaQueries.indexOf('(prefers-contrast: more)') !== -1);
  assert.strictEqual(page.root.attrs['data-contrast'], 'high');
  assert.ok(page.pressed().indexOf('contrast=high') !== -1);
  assert.strictEqual(page.calls.set, 0);
});

test('a click sets the attribute, moves aria-pressed, and stores all three choices under one key', () => {
  const page = run();
  const dark = page.buttons.filter((b) => b.dataset.value === 'dark')[0];
  page.click(dark);
  assert.strictEqual(page.root.attrs['data-theme'], 'dark');
  assert.deepStrictEqual(page.pressed().sort(), ['contrast=standard', 'font=standard', 'theme=dark']);
  assert.deepStrictEqual(Object.keys(page.store), ['display-options']);
  assert.deepStrictEqual(JSON.parse(page.store['display-options']),
    { theme: 'dark', font: 'standard', contrast: 'standard' });
  const atkinson = page.buttons.filter((b) => b.dataset.value === 'atkinson')[0];
  page.click(atkinson);
  assert.strictEqual(page.root.attrs['data-font'], 'atkinson');
  assert.deepStrictEqual(JSON.parse(page.store['display-options']),
    { theme: 'dark', font: 'atkinson', contrast: 'standard' });
});

test('a click on something inside a button counts as a click on the button', () => {
  const page = run();
  const high = page.buttons.filter((b) => b.dataset.value === 'high')[0];
  page.click({ closest: (selector) => (selector === '[data-display-option]' ? high : null) });
  assert.strictEqual(page.root.attrs['data-contrast'], 'high');
});

test('saved choices come back on the next visit', () => {
  const page = run({ storage: JSON.stringify({ theme: 'light', font: 'atkinson', contrast: 'high' }) });
  assert.deepStrictEqual(page.root.attrs, { 'data-theme': 'light', 'data-font': 'atkinson', 'data-contrast': 'high' });
  assert.deepStrictEqual(page.pressed().sort(), ['contrast=high', 'font=atkinson', 'theme=light']);
});

test('a saved choice beats the system more-contrast setting', () => {
  const page = run({ moreContrast: true, storage: JSON.stringify({ contrast: 'standard' }) });
  assert.strictEqual(page.root.attrs['data-contrast'], 'standard');
});

test('saved values that are not allowed are ignored, field by field', () => {
  const page = run({ storage: JSON.stringify({ theme: 'neon', font: 'atkinson', contrast: 7 }) });
  assert.deepStrictEqual(page.root.attrs, { 'data-theme': 'system', 'data-font': 'atkinson', 'data-contrast': 'standard' });
});

test('junk in storage falls back to the defaults', () => {
  for (const junk of ['{not json', 'null', '[]', '"text"', '42']) {
    const page = run({ storage: junk });
    assert.deepStrictEqual(page.root.attrs, { 'data-theme': 'system', 'data-font': 'standard', 'data-contrast': 'standard' }, junk);
  }
});

test('storage that throws on read or on access leaves a working page that forgets', () => {
  for (const mode of ['throws', 'blocked']) {
    const page = run({ storage: mode });
    assert.strictEqual(page.root.attrs['data-theme'], 'system', mode);
    const dark = page.buttons.filter((b) => b.dataset.value === 'dark')[0];
    page.click(dark);
    assert.strictEqual(page.root.attrs['data-theme'], 'dark', mode + ': the choice still applies this visit');
    assert.ok(page.pressed().indexOf('theme=dark') !== -1, mode);
  }
});

test('a failed write (full or blocked storage) does not stop the choice from applying', () => {
  const page = run({ writeThrows: true });
  const light = page.buttons.filter((b) => b.dataset.value === 'light')[0];
  page.click(light);
  assert.strictEqual(page.root.attrs['data-theme'], 'light');
  assert.strictEqual(page.calls.set, 1);
});

test('clicks that are not on a valid option change nothing', () => {
  const page = run();
  const before = JSON.stringify(page.root.attrs);
  page.click({ closest: () => null });
  page.click({});
  page.click(fakeButton('theme', 'neon'));
  page.click(fakeButton('size', 'big'));
  assert.strictEqual(JSON.stringify(page.root.attrs), before);
  assert.strictEqual(page.calls.set, 0);
});

// Code review 1, finding 8: display.js loads in the head, before the buttons exist. The choice
// must reach <html> at once (before the first paint), and aria-pressed must follow when the page
// has been parsed.
test('run in the head: the saved choice is on <html> at once and the buttons catch up later', () => {
  const saved = JSON.stringify({ theme: 'dark', font: 'atkinson', contrast: 'high' });
  const page = run({ storage: saved, lateButtons: true });
  assert.deepStrictEqual(page.root.attrs, { 'data-theme': 'dark', 'data-font': 'atkinson', 'data-contrast': 'high' });
  assert.deepStrictEqual(page.pressed(), [], 'no button exists yet');
  assert.strictEqual(typeof page.listeners.DOMContentLoaded, 'function');
  page.domReady();
  assert.deepStrictEqual(page.pressed().sort(), ['contrast=high', 'font=atkinson', 'theme=dark']);
});

test('run in the head: a click after the page is parsed still works and is remembered', () => {
  const page = run({ lateButtons: true });
  page.domReady();
  page.click(page.buttons.filter((b) => b.dataset.value === 'light')[0]);
  assert.strictEqual(page.root.attrs['data-theme'], 'light');
  assert.deepStrictEqual(JSON.parse(page.store['display-options']),
    { theme: 'light', font: 'standard', contrast: 'standard' });
});

test('run in the head with storage blocked: the defaults apply and the page still starts', () => {
  const page = run({ storage: 'blocked', lateButtons: true });
  assert.strictEqual(page.root.attrs['data-theme'], 'system');
  page.domReady();
  assert.ok(page.pressed().indexOf('theme=system') !== -1);
});

test('run after the page is parsed: no extra listener is needed', () => {
  const page = run();
  assert.strictEqual(page.listeners.DOMContentLoaded, undefined);
});
