'use strict';
// Static checks on index.html, display.css, and the scripts the page loads, run with
// `node --test` from web/.
//   - Contrast: the page takes every color from tokens defined in display.css for four
//     combinations (light or dark, standard or high contrast). Each combination is checked with
//     the formulas in the WCAG 2.2 glossary (relative luminance and contrast ratio). Standard:
//     text 4.5:1 (SC 1.4.3), borders, focus outlines, and the pressed state 3:1 (SC 1.4.11).
//     High contrast: text 7:1 (SC 1.4.6, Level AAA), non-text 3:1 (SC 1.4.11 has no enhanced
//     level). The page's own CSS may not contain a literal color, so a new color cannot be
//     added without a check.
//   - Labels: every input and select has a visible <label for>, and every aria-describedby
//     points at an element that exists. The display-option buttons are in labeled groups.
//   - Privacy: the page loads nothing from another origin, and the scripts use no network,
//     dynamic-code, or HTML-insertion API. Only display.js may use localStorage, and only for
//     the key "display-options".
// These checks do not replace testing with a screen reader or a keyboard walk-through.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const WEB = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(WEB, 'index.html'), 'utf8');
const displayCss = fs.readFileSync(path.join(WEB, 'display.css'), 'utf8');
const inlineStyle = (/<style>([\s\S]*?)<\/style>/.exec(html) || [null, ''])[1];

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

// ---- the four palettes in display.css ------------------------------------------------------

const TOKENS = ['bg', 'fg', 'muted', 'link', 'border', 'focus', 'panel', 'field-bg', 'field-border',
  'notice-border', 'warn-bg', 'warn-fg', 'warn-border', 'error-bg', 'error-fg', 'error-border',
  'pressed-bg', 'pressed-fg'];

function stripComments(css) { return css.replace(/\/\*[\s\S]*?\*\//g, ''); }

// Splits CSS into top-level blocks and the body of the dark media block.
function parseCss(css) {
  let text = stripComments(css);
  let media = '';
  const start = text.indexOf('@media (prefers-color-scheme: dark)');
  if (start !== -1) {
    const open = text.indexOf('{', start);
    let depth = 0;
    let end = open;
    for (; end < text.length; end += 1) {
      if (text[end] === '{') { depth += 1; }
      if (text[end] === '}') { depth -= 1; if (depth === 0) { break; } }
    }
    media = text.slice(open + 1, end);
    text = text.slice(0, start) + text.slice(end + 1);
  }
  return { top: blocks(text), media: blocks(media) };
}
function blocks(text) {
  const out = [];
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    out.push({ selector: m[1].replace(/\s+/g, ' ').trim(), body: m[2] });
  }
  return out;
}
function tokensOf(body) {
  const map = {};
  const re = /--([a-z-]+)\s*:\s*([^;]+);/g;
  let m;
  while ((m = re.exec(body)) !== null) { map[m[1]] = m[2].trim(); }
  return map;
}
function palette(list, selector) {
  // A selector may also appear in a block that only sets color-scheme; count the token blocks.
  const found = list.filter((b) => b.selector === selector && Object.keys(tokensOf(b.body)).length > 0);
  assert.strictEqual(found.length, 1, 'expected exactly one token block for ' + selector + ', found ' + found.length);
  return tokensOf(found[0].body);
}

const parsed = parseCss(displayCss);
const PALETTES = {
  'light standard': palette(parsed.top, ':root'),
  'light high': palette(parsed.top, ':root[data-contrast="high"]'),
  'dark standard': palette(parsed.top, ':root[data-theme="dark"]'),
  'dark high': palette(parsed.top, ':root[data-theme="dark"][data-contrast="high"]')
};

test('each of the four combinations defines every token as a six-digit hex color', () => {
  for (const name of Object.keys(PALETTES)) {
    for (const token of TOKENS) {
      assert.match(PALETTES[name][token] || '', /^#[0-9a-fA-F]{6}$/, name + ' --' + token);
    }
    const extra = Object.keys(PALETTES[name]).filter((t) => TOKENS.indexOf(t) === -1);
    assert.deepStrictEqual(extra, [], name + ' defines unchecked tokens: ' + extra.join(', '));
  }
});

test('the system-dark rules repeat the two dark palettes and skip an explicit light choice', () => {
  const darkStandard = palette(parsed.media, ':root:not([data-theme="light"])');
  const darkHigh = palette(parsed.media, ':root:not([data-theme="light"])[data-contrast="high"]');
  assert.deepStrictEqual(darkStandard, PALETTES['dark standard']);
  assert.deepStrictEqual(darkHigh, PALETTES['dark high']);
});

// [foreground token, background token, kind, what it is]. Kind t is text, n is non-text.
const PAIRS = [
  ['fg', 'bg', 't', 'body text'],
  ['fg', 'panel', 't', 'text in the notice, table headings, buttons, and code'],
  ['muted', 'bg', 't', 'muted and hint text'],
  ['muted', 'panel', 't', 'muted text in the notice'],
  ['link', 'bg', 't', 'links'],
  ['link', 'panel', 't', 'links on a panel'],
  ['fg', 'field-bg', 't', 'text in fields'],
  ['warn-fg', 'warn-bg', 't', 'warning text'],
  ['error-fg', 'error-bg', 't', 'error text'],
  ['pressed-fg', 'pressed-bg', 't', 'text on a pressed display-option button'],
  ['field-border', 'bg', 'n', 'input borders'],
  ['border', 'bg', 'n', 'section and table borders'],
  ['border', 'panel', 'n', 'table borders on a panel'],
  ['notice-border', 'panel', 'n', 'notice border'],
  ['fg', 'bg', 'n', 'button border'],
  ['warn-border', 'bg', 'n', 'warning border'],
  ['error-border', 'bg', 'n', 'error border'],
  ['focus', 'bg', 'n', 'focus outline'],
  ['focus', 'panel', 'n', 'focus outline on a panel'],
  ['pressed-bg', 'bg', 'n', 'pressed button against the page'],
  ['pressed-bg', 'panel', 'n', 'pressed button against an unpressed one']
];

test('every color pair meets its WCAG ratio in all four combinations', () => {
  for (const name of Object.keys(PALETTES)) {
    const high = name.indexOf('high') !== -1;
    const minimum = { t: high ? 7 : 4.5, n: 3 };
    for (const [fg, bg, kind, what] of PAIRS) {
      const ratio = contrast(PALETTES[name][fg], PALETTES[name][bg]);
      assert.ok(ratio >= minimum[kind], name + ', ' + what + ': ' + PALETTES[name][fg] + ' on ' +
        PALETTES[name][bg] + ' is ' + ratio.toFixed(2) + ':1, needs ' + minimum[kind]);
    }
  }
});

test('the light and dark palettes really differ, and high contrast differs from standard', () => {
  assert.notStrictEqual(PALETTES['light standard'].bg, PALETTES['dark standard'].bg);
  assert.notStrictEqual(PALETTES['light standard'].fg, PALETTES['light high'].fg);
  assert.notStrictEqual(PALETTES['dark standard'].fg, PALETTES['dark high'].fg);
  assert.ok(luminance(PALETTES['light standard'].bg) > 0.5);
  assert.ok(luminance(PALETTES['dark standard'].bg) < 0.1);
  assert.ok(luminance(PALETTES['light high'].bg) > 0.5);
  assert.ok(luminance(PALETTES['dark high'].bg) < 0.1);
});

test('the page CSS holds no literal color: every color comes from a token', () => {
  assert.ok(inlineStyle.length > 0, 'index.html has an inline style block');
  assert.ok(!/#[0-9a-fA-F]{3,8}\b/.test(inlineStyle), 'a hex color in the inline style');
  assert.ok(!/\b(rgb|rgba|hsl|hsla|hwb|lab|lch|oklab|oklch|color|color-mix|light-dark)\(/i.test(inlineStyle),
    'a color function in the inline style');
  const declarations = inlineStyle.match(/(^|[;{\s])(color|background|background-color|border[a-z-]*|outline[a-z-]*)\s*:[^;}]*/g) || [];
  for (const d of declarations) {
    const value = d.slice(d.indexOf(':') + 1);
    const withoutVars = value.replace(/var\(--[a-z-]+\)/g, '').replace(/\b\d*\.?\d+(px|rem|em)\b|\b0\b/g, '');
    assert.ok(!/\b(black|white|red|green|blue|gray|grey|silver|orange|yellow|purple|navy|teal|maroon)\b/i.test(withoutVars),
      'a named color in: ' + d.trim());
  }
});

test('every var(--token) in the page CSS and display.css is a defined token', () => {
  const all = stripComments(inlineStyle) + stripComments(displayCss);
  const used = new Set((all.match(/var\(--([a-z-]+)\)/g) || []).map((s) => s.slice(6, -1)));
  assert.ok(used.size >= 10, 'expected the page to use tokens, found ' + used.size);
  for (const token of used) { assert.ok(TOKENS.indexOf(token) !== -1, '--' + token + ' is not a checked token'); }
});

test('focus: a visible outline from the focus token, never removed', () => {
  const css = stripComments(displayCss) + stripComments(inlineStyle);
  assert.match(css, /:focus-visible\s*\{[^}]*outline:\s*3px solid var\(--focus\)/);
  assert.ok(!/outline\s*:\s*(none|0)\b/.test(css), 'an outline is removed');
});

test('the pressed state of a display-option button is shown by color pair and weight', () => {
  const css = stripComments(inlineStyle);
  const rule = /\[aria-pressed="true"\]\s*\{([^}]*)\}/.exec(css);
  assert.ok(rule, 'no [aria-pressed="true"] rule');
  assert.match(rule[1], /var\(--pressed-bg\)/);
  assert.match(rule[1], /var\(--pressed-fg\)/);
  assert.match(rule[1], /font-weight:\s*700/);
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

test('the display options are three labeled button groups with the allowed values', () => {
  const expected = { theme: ['system', 'light', 'dark'], contrast: ['standard', 'high'], font: ['standard', 'atkinson'] };
  const groups = html.match(/<div\b[^>]*role="group"[^>]*aria-label="[^"]+"[^>]*>/g) || [];
  assert.ok(groups.length >= 3, 'expected three labeled groups, found ' + groups.length);
  const buttons = html.match(/<button\b[^>]*data-display-option="[^"]*"[^>]*>/g) || [];
  assert.strictEqual(buttons.length, 7);
  const seen = {};
  for (const b of buttons) {
    assert.match(b, /type="button"/, 'a display button without type="button"');
    const option = /data-display-option="([^"]*)"/.exec(b)[1];
    const value = /data-value="([^"]*)"/.exec(b)[1];
    assert.ok(expected[option] && expected[option].indexOf(value) !== -1, 'bad option ' + option + '=' + value);
    seen[option] = (seen[option] || []).concat(value);
  }
  assert.deepStrictEqual(seen, expected);
  const text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
  assert.match(text, /Atkinson Hyperlegible Next/);
});

test('the page loads only its own stylesheet and scripts, from relative paths', () => {
  assert.deepStrictEqual(html.match(/<link\b[^>]*>/gi), ['<link rel="stylesheet" href="display.css">']);
  assert.ok(!/<img\b|<iframe\b|<object\b|<embed\b|<video\b|<audio\b/i.test(html));
  const scripts = html.match(/<script\b[^>]*>/g) || [];
  assert.deepStrictEqual(scripts, ['<script src="display.js">', '<script src="model.js">',
    '<script src="presets.js">', '<script src="ui.js">']);
  assert.ok(!/@import|url\(/i.test(html), 'no CSS imports or url() in the page');
});

test('display.css loads one font from a local relative path and nothing else from outside', () => {
  const css = stripComments(displayCss);
  assert.ok(!/@import|https?:|\/\//.test(css), 'an import or an absolute address in display.css');
  const urls = css.match(/url\(([^)]*)\)/g) || [];
  assert.strictEqual(urls.length, 1);
  const target = /url\(["']?([^"')]+)["']?\)/.exec(urls[0])[1];
  assert.ok(!/^[a-z]+:|^\//i.test(target), 'the font path must be relative: ' + target);
  assert.ok(fs.existsSync(path.join(WEB, decodeURIComponent(target))), 'the font file is missing: ' + target);
  assert.match(target, /%5Bwght%5D/, 'the brackets in the file name are percent-encoded');
});

test('the font and its license are the files NOTICE.txt describes, byte for byte', () => {
  const notice = fs.readFileSync(path.join(WEB, 'NOTICE.txt'), 'utf8');
  const files = { 'fonts/AtkinsonHyperlegibleNext[wght].woff2': 48188, 'fonts/OFL.txt': 4431 };
  for (const name of Object.keys(files)) {
    let bytes = fs.readFileSync(path.join(WEB, name));
    // A Windows checkout with core.autocrlf turns the license's line endings into CRLF; the
    // hash in NOTICE.txt is of the LF form, as the project publishes it. The font is binary.
    if (name.endsWith('.txt')) { bytes = Buffer.from(bytes.toString('latin1').replace(/\r\n/g, '\n'), 'latin1'); }
    assert.strictEqual(bytes.length, files[name], name + ' size');
    const sum = crypto.createHash('sha256').update(bytes).digest('hex');
    assert.ok(notice.indexOf(sum) !== -1, name + ' hash ' + sum + ' is not in NOTICE.txt');
  }
  assert.match(notice, /keeps its own license/);
});

const NET_AND_DYNAMIC = ['fetch(', 'XMLHttpRequest', 'sendBeacon', 'WebSocket', 'EventSource',
  'sessionStorage', 'indexedDB', 'document.cookie', 'innerHTML', 'outerHTML', 'insertAdjacentHTML',
  'document.write', 'eval(', 'new Function', 'importScripts', 'import(', 'navigator.'];

test('the page scripts use no network, storage, dynamic-code, or HTML-insertion API', () => {
  for (const file of ['model.js', 'presets.js', 'ui.js']) {
    const source = fs.readFileSync(path.join(WEB, file), 'utf8');
    for (const word of NET_AND_DYNAMIC.concat(['localStorage'])) {
      assert.ok(source.indexOf(word) === -1, file + ' uses ' + word);
    }
  }
});

test('display.js uses no network or dynamic-code API and stores only the key "display-options"', () => {
  const source = fs.readFileSync(path.join(WEB, 'display.js'), 'utf8');
  for (const word of NET_AND_DYNAMIC) {
    assert.ok(source.indexOf(word) === -1, 'display.js uses ' + word);
  }
  const keys = source.match(/var KEY = '([^']*)';/g) || [];
  assert.deepStrictEqual(keys, ["var KEY = 'display-options';"]);
  const uses = source.match(/localStorage[^;]*/g) || [];
  assert.strictEqual(uses.length, 2, 'expected one read and one write of localStorage');
  for (const use of uses) {
    assert.match(use, /^localStorage\.(getItem\(KEY\)|setItem\(KEY, JSON\.stringify\(state\)\))/, 'unexpected use: ' + use);
  }
});

test('the scripts are classic scripts, not ES modules', () => {
  for (const file of ['display.js', 'model.js', 'presets.js', 'ui.js']) {
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

test('the privacy line says the page stores only the display choices', () => {
  const text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
  assert.ok(text.indexOf('Stores only your display choices (theme, contrast, font) in this browser. ' +
    'Nothing leaves the page.') !== -1, 'the privacy line is missing');
  assert.ok(!/stores nothing/i.test(text), 'the old "stores nothing" line is still there');
  assert.match(text, /makes no network request/i);
});

test('metered and committed rental are separate sections, never one table', () => {
  assert.match(html, /<section aria-labelledby="metered-title">/);
  assert.match(html, /<section aria-labelledby="committed-title">/);
  assert.ok(html.indexOf('id="m-results"') !== -1 && html.indexOf('id="c-results"') !== -1);
});
