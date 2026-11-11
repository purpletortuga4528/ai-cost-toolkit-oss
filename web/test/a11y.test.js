'use strict';
// Static checks for code review 1, findings 8 and 9. Run with `node --test` from web/.
//
// Finding 8: display.js loads in the head, so a saved theme or high contrast is on <html>
// before the first paint (measured: with the script at the end of the body, the default look
// painted first in about a third of runs when the CPU was slowed six times).
// Finding 9: no empty column headings, no live regions that re-render on every keystroke, and a
// message when JavaScript is off.
//
// These checks read the files; they do not replace a pass with a screen reader, which has NOT
// been done. Whether finding 9's changes help in practice is untested.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const WEB = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(WEB, 'index.html'), 'utf8');
const uiSource = fs.readFileSync(path.join(WEB, 'ui.js'), 'utf8');

test('no table the page builds has an empty column heading', () => {
  assert.ok(!/\[\s*''\s*,/.test(uiSource), "ui.js builds a table with an empty '' heading");
  assert.ok(uiSource.indexOf("'Quantity'") !== -1);
});

test('the result regions are not live regions, so they are not read out on every keystroke', () => {
  for (const id of ['o-results', 's-results', 'm-results', 'c-results']) {
    const tag = new RegExp('<div\\b[^>]*\\bid="' + id + '"[^>]*>').exec(html);
    assert.ok(tag, 'no #' + id);
    assert.ok(!/aria-live/.test(tag[0]), '#' + id + ' is still a live region');
  }
  assert.match(html, /<div id="stale-banner" role="status" aria-live="polite">/);
});

test('errors the page shows are still announced as alerts', () => {
  assert.match(uiSource, /setAttribute\('role', 'alert'\)/);
});

test('the page says what it needs when JavaScript is off', () => {
  const block = /<noscript>([\s\S]*?)<\/noscript>/.exec(html);
  assert.ok(block, 'no <noscript> message');
  assert.match(block[1].replace(/<[^>]+>/g, ' '), /needs JavaScript/);
  assert.ok(html.indexOf('<noscript>') > html.indexOf('<body>'), 'the message belongs in the body');
});

test('display.js loads in the head so a saved theme applies before the first paint', () => {
  const head = /<head>([\s\S]*?)<\/head>/.exec(html)[1];
  const body = html.slice(html.indexOf('<body>'));
  assert.deepStrictEqual(head.match(/<script\b[^>]*>/g), ['<script src="display.js">']);
  assert.ok(head.indexOf('display.css') < head.indexOf('display.js'), 'the stylesheet comes first');
  assert.deepStrictEqual(body.match(/<script\b[^>]*>/g),
    ['<script src="model.js">', '<script src="presets.js">', '<script src="ui.js">']);
});

test('ui.js shows a note when a sensitivity list is cut to its first values', () => {
  assert.match(uiSource, /parseValueList/);
  assert.match(uiSource, /only the first ' \+ MAX_SENSITIVITY_VALUES/);
});

// ---- code review 1, finding 11 ---------------------------------------------------------------

test('forced colors: a pressed button changes its border, not only its weight', () => {
  const inline = (/<style>([\s\S]*?)<\/style>/.exec(html) || [null, ''])[1];
  const media = /@media \(forced-colors: active\)\s*\{([\s\S]*?\})\s*\}/.exec(inline);
  assert.ok(media, 'no forced-colors rule in the page CSS');
  const rule = /\[aria-pressed="true"\]\s*\{([^}]*)\}/.exec(media[1]);
  assert.ok(rule, 'the forced-colors block does not style the pressed button');
  assert.match(rule[1], /border-style:\s*double/);
  assert.match(rule[1], /border-width:\s*[3-9]px/);
  // No color in the rule: in forced colors the browser picks the colors.
  assert.ok(!/#[0-9a-fA-F]{3,8}\b|\b(rgb|hsl)a?\(/.test(rule[1]));
});

// A Content-Security-Policy in a <meta> tag. It limits what the page can load or run even if it is
// hosted: scripts, styles, and fonts only from the page's own origin, and no network connection,
// frame, form post, or <base> change. Styles allow 'unsafe-inline' because the page keeps its CSS in
// a <style> block; scripts do not.
function policy() {
  const tag = /<meta http-equiv="Content-Security-Policy" content="([^"]*)">/.exec(html);
  assert.ok(tag, 'no Content-Security-Policy meta tag');
  const directives = {};
  tag[1].split(';').map((d) => d.trim()).filter(Boolean).forEach((d) => {
    const parts = d.split(/\s+/);
    directives[parts[0]] = parts.slice(1);
  });
  return { text: tag[1], directives, tag: tag[0] };
}

test('the page carries a Content-Security-Policy that allows only its own scripts, styles, and fonts', () => {
  const { directives } = policy();
  assert.deepStrictEqual(directives['default-src'], ["'none'"]);
  assert.deepStrictEqual(directives['script-src'], ["'self'"]);
  assert.deepStrictEqual(directives['style-src'], ["'self'", "'unsafe-inline'"]);
  assert.deepStrictEqual(directives['font-src'], ["'self'"]);
  assert.deepStrictEqual(directives['base-uri'], ["'none'"]);
  assert.deepStrictEqual(directives['form-action'], ["'none'"]);
  // Nothing else is opened up: no connections, images, frames, or workers.
  for (const name of Object.keys(directives)) {
    assert.ok(['default-src', 'script-src', 'style-src', 'font-src', 'base-uri', 'form-action'].includes(name),
      'unexpected directive ' + name);
  }
});

test('the policy never allows inline or dynamic script, or another origin', () => {
  const { text } = policy();
  assert.ok(!/unsafe-eval|unsafe-hashes|https?:|\*|data:|blob:/.test(text));
  assert.ok(!/script-src[^;]*unsafe-inline/.test(text));
});

test('the policy is the first element in the head after the character set, before any script or style', () => {
  const head = /<head>([\s\S]*?)<\/head>/.exec(html)[1];
  const policyAt = head.indexOf('Content-Security-Policy');
  assert.ok(policyAt !== -1);
  assert.ok(head.indexOf('<script') > policyAt && head.indexOf('<link') > policyAt && head.indexOf('<style>') > policyAt);
  assert.ok(head.indexOf('charset') < policyAt);
});

test('the page has no inline script, inline event handler, or javascript: link for the policy to block', () => {
  assert.ok(!/<script(?![^>]*\bsrc=)[^>]*>/.test(html), 'an inline script');
  assert.ok(!/\son[a-z]+\s*=/.test(html), 'an inline event handler');
  assert.ok(!/javascript:/i.test(html));
  assert.ok(!/\sstyle=/.test(html), 'an inline style attribute (blocked unless unsafe-inline for styles)');
});
