'use strict';
// A small fake page for running ui.js under Node, with no browser and no dependency.
//
// It builds one fake element for every id in index.html, gives each <input> and <select> a
// value, turns each label into the text `label[for="id"]` returns, and runs model.js,
// presets.js, and ui.js in one context, as the page loads them. It supports only what ui.js
// uses: getElementById, createElement, createTextNode, querySelector for a label, and
// querySelectorAll for 'tbody tr', plus textContent, appendChild, removeChild, firstChild,
// lastChild, setAttribute, className, value, validity, and addEventListener.
//
// It is not a browser: it does not lay anything out or check styles. Browser behavior is
// checked separately, in headless Chrome and Edge, and noted in the session logs.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const WEB = path.join(__dirname, '..', '..');
const html = fs.readFileSync(path.join(WEB, 'index.html'), 'utf8');

class FakeNode {
  constructor(tag) {
    this.tagName = tag;
    this.children = [];
    this.ownText = '';
    this.attrs = {};
    this.className = '';
    this.value = '';
    this.validity = { badInput: false };
    this.listeners = {};
  }
  get textContent() { return this.ownText + this.children.map((c) => c.textContent).join(''); }
  set textContent(text) { this.children = []; this.ownText = String(text); }
  get firstChild() { return this.children.length ? this.children[0] : null; }
  get lastChild() { return this.children.length ? this.children[this.children.length - 1] : null; }
  appendChild(node) { this.children.push(node); return node; }
  removeChild(node) { this.children.splice(this.children.indexOf(node), 1); return node; }
  setAttribute(name, value) { this.attrs[name] = String(value); }
  getAttribute(name) { return name in this.attrs ? this.attrs[name] : null; }
  addEventListener(type, fn) { (this.listeners[type] = this.listeners[type] || []).push(fn); }
  querySelectorAll(selector) {
    if (selector !== 'tbody tr') { throw new Error('fake page: unsupported selector ' + selector); }
    const rows = [];
    const visit = (node) => {
      node.children.forEach((child) => {
        if (child.tagName === 'tbody') { child.children.forEach((r) => { if (r.tagName === 'tr') { rows.push(r); } }); }
        visit(child);
      });
    };
    visit(this);
    return rows;
  }
  // Descendants with a tag name, for the tests.
  all(tag) {
    const found = [];
    const visit = (node) => node.children.forEach((c) => { if (c.tagName === tag) { found.push(c); } visit(c); });
    visit(this);
    return found;
  }
}

function loadPage() {
  const nodes = {};
  const labels = {};
  const idRe = /<(\w+)\b[^>]*\bid="([^"]+)"/g;
  let m;
  while ((m = idRe.exec(html)) !== null) { nodes[m[2]] = new FakeNode(m[1]); }
  const labelRe = /<label\b[^>]*\bfor="([^"]+)"[^>]*>([\s\S]*?)<\/label>/g;
  while ((m = labelRe.exec(html)) !== null) { labels[m[1]] = m[2].replace(/<[^>]+>/g, '').trim(); }
  // An <input value="5"> starts with that value.
  const valueRe = /<input\b[^>]*\bid="([^"]+)"[^>]*\bvalue="([^"]*)"/g;
  while ((m = valueRe.exec(html)) !== null) { nodes[m[1]].value = m[2]; }

  const document = {
    getElementById: (id) => nodes[id] || null,
    createElement: (tag) => new FakeNode(tag),
    createTextNode: (text) => { const n = new FakeNode('#text'); n.ownText = String(text); return n; },
    querySelector: (selector) => {
      const match = /^label\[for="([^"]+)"\]$/.exec(selector);
      if (!match || !(match[1] in labels)) { return null; }
      const label = new FakeNode('label');
      label.ownText = labels[match[1]];
      return label;
    }
  };
  const context = vm.createContext({ document, console });
  for (const file of ['model.js', 'presets.js', 'ui.js']) {
    vm.runInContext(fs.readFileSync(path.join(WEB, file), 'utf8'), context, { filename: file });
  }

  // What a browser does with an exception in an event handler: report it and carry on.
  const uncaught = [];
  function type(id, value) {
    nodes[id].value = String(value);
    (nodes[id].listeners.input || []).forEach((fn) => {
      try { fn({ target: nodes[id] }); } catch (error) { uncaught.push(error); }
    });
  }
  return {
    byId: (id) => nodes[id],
    text: (id) => nodes[id].textContent,
    type,
    fill(values) { Object.keys(values).forEach((id) => type(id, values[id])); },
    uncaught,
    context
  };
}

module.exports = { loadPage };
