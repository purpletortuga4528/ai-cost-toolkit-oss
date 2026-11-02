'use strict';
// Static checks on index.html and the scripts it loads, run with `node --test` from web/.
//   - Contrast: every color pair the page's CSS uses meets WCAG 2.2 (SC 1.4.3 text 4.5:1;
//     SC 1.4.11 borders and focus outlines 3:1), computed with the formulas in the WCAG 2.2
//     glossary (relative luminance and contrast ratio). Every hex color in the CSS must be in
//     the checked list, so a new color cannot be added without a check.
//   - Labels: every input and select has a visible <label for>, and every aria-describedby
//     points at an element that exists.
//   - Privacy: the page loads nothing from another origin, and the scripts use no network,
//     storage, or HTML-insertion API.
// These checks do not replace testing with a screen reader or a keyboard walk-through.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const WEB = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(WEB, 'index.html'), 'utf8');

function channel(value8) {
  const s = value8 / 255;
  return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}
function luminance(hex) {
  const n = parseInt(hex.slice(1), 16);
  return 0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255);
}
function contrast(a, b) {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

test('contrast formula: black on white is 21:1 and a color on itself is 1:1', () => {
  assert.ok(Math.abs(contrast('#000000', '#ffffff') - 21) < 1e-9);
  assert.ok(Math.abs(contrast('#777777', '#777777') - 1) < 1e-9);
});

// [foreground, background, minimum ratio, what it is]
const PAIRS = [
  ['#1a1a1a', '#ffffff', 4.5, 'body text'],
  ['#1a1a1a', '#f2f2f2', 4.5, 'text in the notice'],
  ['#4d4d4d', '#ffffff', 4.5, 'muted and hint text'],
  ['#4d4d4d', '#f2f2f2', 4.5, 'muted text in the notice'],
  ['#0a4fb3', '#ffffff', 4.5, 'links'],
  ['#1a1a1a', '#ececec', 4.5, 'table headings, buttons, code'],
  ['#3d1f00', '#fff1d6', 4.5, 'warning text'],
  ['#5c0f0f', '#fde8e8', 4.5, 'error text'],
  ['#5c5c5c', '#ffffff', 3, 'input borders'],
  ['#767676', '#ffffff', 3, 'section and table borders'],
  ['#4d4d4d', '#ffffff', 3, 'notice border'],
  ['#7a3e00', '#ffffff', 3, 'warning border'],
  ['#8a1c1c', '#ffffff', 3, 'error border'],
  ['#0a4fb3', '#ffffff', 3, 'focus outline'],
  ['#1a1a1a', '#ffffff', 3, 'button border']
];

test('every color pair meets its WCAG ratio', () => {
  for (const [fg, bg, min, what] of PAIRS) {
    const ratio = contrast(fg, bg);
    assert.ok(ratio >= min, what + ': ' + fg + ' on ' + bg + ' is ' + ratio.toFixed(2) + ':1, needs ' + min);
  }
});

test('every hex color in the page CSS is in the checked list', () => {
  const style = /<style>([\s\S]*?)<\/style>/.exec(html);
  assert.ok(style, 'index.html has an inline style block');
  const used = new Set((style[1].match(/#[0-9a-fA-F]{6}\b/g) || []).map((c) => c.toLowerCase()));
  const checked = new Set();
  PAIRS.forEach(([fg, bg]) => { checked.add(fg); checked.add(bg); });
  for (const color of used) { assert.ok(checked.has(color), color + ' is not in the checked pairs'); }
  assert.ok(!/#[0-9a-fA-F]{3}\b(?![0-9a-fA-F])/.test(style[1].replace(/#[0-9a-fA-F]{6}/g, '')),
    'use six-digit hex colors so they can be checked');
});

test('the page declares a language and a title, and scales on small screens', () => {
  assert.match(html, /<html lang="en">/);
  assert.match(html, /<title>[^<]+<\/title>/);
  assert.match(html, /<meta name="viewport" content="width=device-width, initial-scale=1">/);
});

test('every id is unique', () => {
  const ids = (html.match(/\bid="([^"]+)"/g) || []).map((m) => m.slice(4, -1));
  assert.strictEqual(new Set(ids).size, ids.length, 'duplicate ids: ' +
    ids.filter((id, i) => ids.indexOf(id) !== i).join(', '));
});

test('every input and select has a visible label that points at it', () => {
  const controls = [];
  const re = /<(input|select)\b[^>]*\bid="([^"]+)"[^>]*>/g;
  let m;
  while ((m = re.exec(html)) !== null) {
    if (/type="hidden"/.test(m[0])) { continue; }
    controls.push(m[2]);
  }
  assert.ok(controls.length >= 15, 'expected the page fields, found ' + controls.length);
  for (const id of controls) {
    const label = new RegExp('<label\\b[^>]*\\bfor="' + id + '"[^>]*>([\\s\\S]*?)</label>').exec(html);
    assert.ok(label, 'no <label for="' + id + '">');
    assert.ok(label[1].replace(/<[^>]+>/g, '').trim().length > 0, 'empty label for ' + id);
  }
});

test('every aria-describedby points at an element that exists', () => {
  const ids = new Set((html.match(/\bid="([^"]+)"/g) || []).map((s) => s.slice(4, -1)));
  const re = /aria-describedby="([^"]+)"/g;
  let m;
  while ((m = re.exec(html)) !== null) {
    for (const target of m[1].split(/\s+/)) { assert.ok(ids.has(target), 'missing #' + target); }
  }
});

test('every section is named by its heading', () => {
  const re = /<section\b[^>]*aria-labelledby="([^"]+)"/g;
  let m;
  let count = 0;
  while ((m = re.exec(html)) !== null) {
    count += 1;
    assert.match(html, new RegExp('<h2 id="' + m[1] + '"'), 'no heading #' + m[1]);
  }
  assert.ok(count >= 7, 'expected the page sections, found ' + count);
});

test('the page loads nothing from another origin', () => {
  assert.ok(!/<link\b/i.test(html), 'no <link> (no external stylesheets or fonts)');
  assert.ok(!/<img\b|<iframe\b|<object\b|<embed\b|<video\b|<audio\b/i.test(html));
  const scripts = html.match(/<script\b[^>]*>/g) || [];
  assert.deepStrictEqual(scripts, ['<script src="model.js">', '<script src="presets.js">', '<script src="ui.js">']);
  assert.ok(!/@import|url\(/i.test(html), 'no CSS imports or url()');
});

test('the scripts use no network, storage, dynamic-code, or HTML-insertion API', () => {
  const forbidden = ['fetch(', 'XMLHttpRequest', 'sendBeacon', 'WebSocket', 'EventSource', 'localStorage',
    'sessionStorage', 'indexedDB', 'document.cookie', 'innerHTML', 'outerHTML', 'insertAdjacentHTML',
    'document.write', 'eval(', 'new Function', 'importScripts', 'import(', 'navigator.'];
  for (const file of ['model.js', 'presets.js', 'ui.js']) {
    const source = fs.readFileSync(path.join(WEB, file), 'utf8');
    for (const word of forbidden) {
      assert.ok(source.indexOf(word) === -1, file + ' uses ' + word);
    }
  }
});

test('the scripts are classic scripts, not ES modules', () => {
  for (const file of ['model.js', 'presets.js', 'ui.js']) {
    const source = fs.readFileSync(path.join(WEB, file), 'utf8');
    assert.ok(!/^\s*(import|export)\s/m.test(source), file + ' has an import or export statement');
  }
  assert.ok(!/type="module"/.test(html));
});

test('the page states the floor and lists every item Brief 04 section 8.4 names as excluded', () => {
  const text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
  assert.match(text, /every owned-hardware result is a floor/i);
  for (const item of ['host systems', 'networking', 'storage', 'redundancy', 'space', 'cooling capital',
    'bandwidth', 'license compliance', 'operating labor', 'safety maintenance']) {
    assert.ok(text.indexOf(item) !== -1, 'notice is missing: ' + item);
  }
  assert.match(text, /capability equivalence/i);
  assert.match(text, /not a recommendation/i);
});

test('metered and committed rental are separate sections, never one table', () => {
  assert.match(html, /<section aria-labelledby="metered-title">/);
  assert.match(html, /<section aria-labelledby="committed-title">/);
  assert.ok(html.indexOf('id="m-results"') !== -1 && html.indexOf('id="c-results"') !== -1);
});
