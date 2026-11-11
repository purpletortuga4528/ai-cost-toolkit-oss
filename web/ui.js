// Page behavior for index.html (Part 1.2). A classic script: it uses the functions that model.js
// and presets.js define as globals. It builds all output with textContent and never inserts
// text as HTML. It makes no network request.
(function () {
  'use strict';

  var TODAY = todayIso();

  function todayIso() {
    var now = new Date();
    var month = String(now.getMonth() + 1);
    var day = String(now.getDate());
    return now.getFullYear() + '-' + (month.length < 2 ? '0' : '') + month + '-' +
      (day.length < 2 ? '0' : '') + day;
  }

  function byId(id) { return document.getElementById(id); }

  function el(tag, text, className) {
    var node = document.createElement(tag);
    if (text !== undefined && text !== null) { node.textContent = text; }
    if (className) { node.className = className; }
    return node;
  }

  function clear(node) {
    while (node.firstChild) { node.removeChild(node.firstChild); }
  }

  // ---- number formatting -------------------------------------------------------------------

  function dollars(value) {
    var digits = Math.abs(value) >= 1 ? 2 : 4;
    return '$' + value.toFixed(digits);
  }

  function plain(value, digits) { return value.toFixed(digits); }

  function grouped(value) {
    return Math.round(value).toLocaleString('en-US');
  }

  // ---- reading fields ----------------------------------------------------------------------

  // Returns { value } for a valid number, { missing: true } for an empty field, and
  // { error: text } for text that is not a number.
  function readNumber(id) {
    var input = byId(id);
    if (input.validity && input.validity.badInput) { return { error: 'is not a number' }; }
    var text = input.value.trim();
    if (text === '') { return { missing: true }; }
    var value = Number(text);
    if (!isFinite(value)) { return { error: 'is not a number' }; }
    return { value: value };
  }

  function labelText(id) {
    var label = document.querySelector('label[for="' + id + '"]');
    return label ? label.textContent : id;
  }

  // Reads a map of { modelName: fieldId }. Returns { values } when every field is a number, or
  // { problems } listing each empty or bad field.
  function collect(fields) {
    var values = {};
    var missing = [];
    var errors = [];
    Object.keys(fields).forEach(function (name) {
      var result = readNumber(fields[name]);
      if (result.missing) { missing.push(labelText(fields[name])); }
      else if (result.error) { errors.push(labelText(fields[name]) + ' ' + result.error); }
      else { values[name] = result.value; }
    });
    if (missing.length === 0 && errors.length === 0) { return { values: values }; }
    return { missing: missing, errors: errors };
  }

  function showNeeds(container, collected) {
    clear(container);
    if (collected.errors.length > 0) {
      var errorBox = el('div', null, 'error');
      errorBox.appendChild(el('p', 'Check these fields:'));
      var errorList = el('ul', null, 'plain');
      collected.errors.forEach(function (text) { errorList.appendChild(el('li', text)); });
      errorBox.appendChild(errorList);
      container.appendChild(errorBox);
    }
    if (collected.missing.length > 0) {
      var box = el('p', 'Enter a value for: ' + collected.missing.join('; ') + '.', 'muted');
      container.appendChild(box);
    }
  }

  var NAMES = {
    throughputPerAccelerator: 'Throughput per accelerator', accelerators: 'Accelerators',
    unitPrice: 'Unit price', amortizationYears: 'Amortization period', tdpWatts: 'TDP',
    tariff: 'Tariff', pue: 'PUE', u: 'Utilization u', p: 'p', hourlyRate: 'Hourly rate',
    apiPricePerMtok: 'API price'
  };

  // The model's messages start with an input name such as "pue" or "u". Show the field's name
  // instead.
  function friendly(message) {
    var first = message.split(' ')[0];
    if (Object.prototype.hasOwnProperty.call(NAMES, first)) {
      return NAMES[first] + message.slice(first.length);
    }
    return message.charAt(0).toUpperCase() + message.slice(1);
  }

  function showError(container, message) {
    clear(container);
    var box = el('div', null, 'error');
    box.setAttribute('role', 'alert');
    box.appendChild(el('p', friendly(message) + '.'));
    container.appendChild(box);
  }

  // A problem in one part of a panel (a break-even that cannot be calculated): shown inside the
  // panel, next to the parts that did work.
  function showPartProblem(container, what, error) {
    var box = el('div', null, 'error');
    box.appendChild(el('p', what + ' could not be calculated: ' + error.message + '.'));
    container.appendChild(box);
  }

  // Runs one panel's render. If it throws, the panel shows the error (as an alert) and the
  // panels after it still render, so none is left showing numbers from an earlier input.
  // `alsoClear` names panels that depend on this one and must not keep old content.
  function safely(id, render, alsoClear) {
    try {
      render();
    } catch (error) {
      showError(byId(id), error.message);
      (alsoClear || []).forEach(function (other) { clear(byId(other)); });
    }
  }

  // The metered cost as a multiple of the API price, as text. A multiple that is not finite or
  // too large for toFixed (1e21) is not shown as a number.
  function ratioText(cost, api) {
    var ratio = cost / api;
    if (!isFinite(ratio) || ratio >= 1e21) { return null; }
    return plain(ratio, 2);
  }

  function apiPrice() {
    var result = readNumber('api-price');
    if (result.value !== undefined && result.value > 0) { return result.value; }
    return null;
  }

  function apiPriceNote(container) {
    var result = readNumber('api-price');
    if (result.error) {
      container.appendChild(el('p', 'API price ' + result.error + '.', 'muted'));
    } else if (result.value !== undefined && result.value <= 0) {
      container.appendChild(el('p', 'API price must be greater than 0 to compare.', 'muted'));
    } else if (result.missing) {
      container.appendChild(el('p', 'Enter an API price above to see a comparison and break-even.', 'muted'));
    }
  }

  // ---- tables ------------------------------------------------------------------------------

  function table(caption, headings, rows, numericFrom) {
    var wrap = el('div', null, 'scroll');
    var t = document.createElement('table');
    t.appendChild(el('caption', caption));
    var head = document.createElement('thead');
    var headRow = document.createElement('tr');
    headings.forEach(function (text, index) {
      var th = el('th', text, index >= numericFrom ? 'num' : '');
      th.setAttribute('scope', 'col');
      headRow.appendChild(th);
    });
    head.appendChild(headRow);
    t.appendChild(head);
    var body = document.createElement('tbody');
    rows.forEach(function (row) {
      var tr = document.createElement('tr');
      row.forEach(function (cell, index) {
        var td;
        if (index === 0) {
          td = el('th', cell);
          td.setAttribute('scope', 'row');
        } else {
          td = el('td', cell, index >= numericFrom ? 'num' : '');
        }
        tr.appendChild(td);
      });
      body.appendChild(tr);
    });
    t.appendChild(body);
    wrap.appendChild(t);
    return wrap;
  }

  // ---- presets -----------------------------------------------------------------------------

  var CUSTOM = 'custom';

  function presetById(group, id) {
    for (var i = 0; i < PRESETS[group].length; i += 1) {
      if (PRESETS[group][i].id === id) { return PRESETS[group][i]; }
    }
    return null;
  }

  function describePreset(preset) {
    var status = presetStatus(preset, TODAY);
    var parts = [preset.kind === 'scenario' ? 'Scenario value' : 'Published value',
      'tier ' + preset.tier, 'as of ' + preset.as_of];
    if (status.scenario) {
      parts.push('no stale clock');
    } else {
      parts.push('shelf life ' + status.shelfLifeDays + ' days, age ' + status.ageDays + ' days');
    }
    return parts.join(', ') + '.';
  }

  function fillPresetSelect(selectId, group) {
    var select = byId(selectId);
    clear(select);
    var custom = el('option', 'Custom value');
    custom.value = CUSTOM;
    select.appendChild(custom);
    PRESETS[group].forEach(function (preset) {
      var option = el('option', preset.label + ' (' + preset.value + ')');
      option.value = preset.id;
      select.appendChild(option);
    });
  }

  // Wires one preset select to its number field. Choosing a preset fills the field; typing in
  // the field switches the select back to Custom. The source line under the field names the
  // selected preset and warns when it is stale.
  function wirePreset(group, selectId, inputId, sourceId, onChange) {
    var select = byId(selectId);
    var input = byId(inputId);
    var source = byId(sourceId);

    function showSource() {
      clear(source);
      var preset = presetById(group, select.value);
      if (!preset) {
        source.textContent = 'Custom value: no source.';
        return;
      }
      source.appendChild(document.createTextNode(describePreset(preset) + ' Source: '));
      var link = el('a', preset.source_url);
      link.href = preset.source_url;
      link.rel = 'noopener noreferrer';
      source.appendChild(link);
      source.appendChild(document.createTextNode('. ' + preset.note));
    }

    select.addEventListener('change', function () {
      var preset = presetById(group, select.value);
      if (preset) { input.value = String(preset.value); }
      showSource();
      onChange();
    });
    input.addEventListener('input', function () {
      var matched = null;
      PRESETS[group].forEach(function (preset) {
        if (Number(input.value) === preset.value && input.value.trim() !== '') { matched = preset; }
      });
      select.value = matched ? matched.id : CUSTOM;
      showSource();
      onChange();
    });
    showSource();
  }

  function selectedPresets() {
    var chosen = [];
    [['tariff', 'o-tariff-preset'], ['pue', 'o-pue-preset']].forEach(function (pair) {
      var preset = presetById(pair[0], byId(pair[1]).value);
      if (preset) { chosen.push(preset); }
    });
    return chosen;
  }

  function renderStaleBanner() {
    var banner = byId('stale-banner');
    clear(banner);
    selectedPresets().forEach(function (preset) {
      var status = presetStatus(preset, TODAY);
      if (status.stale) {
        var box = el('div', null, 'warn');
        box.appendChild(el('p', 'Stale preset: "' + preset.label + '" was read on ' + preset.as_of +
          ', ' + status.ageDays + ' days ago, and its shelf life is ' + status.shelfLifeDays +
          ' days. Check the source before relying on it.'));
        banner.appendChild(box);
      }
      if (status.future) {
        var futureBox = el('div', null, 'warn');
        futureBox.appendChild(el('p', 'Preset "' + preset.label + '" has an as-of date after ' +
          'today (' + preset.as_of + '). Check this computer\'s date and the preset.'));
        banner.appendChild(futureBox);
      }
    });
  }

  function renderPresetTable() {
    var rows = [];
    Object.keys(PRESETS).forEach(function (group) {
      PRESETS[group].forEach(function (preset) {
        var status = presetStatus(preset, TODAY);
        var state = status.scenario ? 'Scenario, no stale clock' : (status.stale ? 'STALE' : 'Within shelf life');
        rows.push([group === 'tariff' ? 'Tariff' : 'PUE', preset.label, String(preset.value),
          preset.tier, preset.as_of, status.scenario ? 'none' : status.shelfLifeDays + ' days',
          state, preset.source_url]);
      });
    });
    var holder = byId('presets-table');
    clear(holder);
    var wrap = table('Presets, as of ' + TODAY,
      ['Kind', 'Preset', 'Value', 'Tier', 'As of', 'Shelf life', 'State', 'Source'], rows, 99);
    // Make each source cell a link.
    var cells = wrap.querySelectorAll('tbody tr');
    for (var i = 0; i < cells.length; i += 1) {
      var last = cells[i].lastChild;
      var url = last.textContent;
      clear(last);
      var link = el('a', url);
      link.href = url;
      link.rel = 'noopener noreferrer';
      last.appendChild(link);
    }
    holder.appendChild(wrap);
  }

  // ---- owned hardware ----------------------------------------------------------------------

  var OWNED_FIELDS = {
    throughputPerAccelerator: 'o-tps', accelerators: 'o-acc', unitPrice: 'o-price',
    amortizationYears: 'o-years', tdpWatts: 'o-tdp', tariff: 'o-tariff', pue: 'o-pue', u: 'o-u'
  };

  function renderOwned() {
    var out = byId('o-results');
    var sens = byId('s-results');
    var collected = collect(OWNED_FIELDS);
    if (!collected.values) {
      showNeeds(out, collected);
      clear(sens);
      return;
    }
    var inputs = collected.values;
    var range;
    try {
      range = ownedCostRange(inputs);
    } catch (error) {
      showError(out, error.message);
      clear(sens);
      return;
    }
    clear(out);
    var floorNote = el('p', 'Floor: ', 'floor');
    floorNote.appendChild(document.createTextNode(
      'these figures leave out the items listed under "Read this first".'));
    out.appendChild(floorNote);
    var lowU = range.pEqualsU;
    var highP = range.pEqualsOne;
    out.appendChild(table('Cost per million output tokens, owned hardware (floor)',
      ['Quantity', 'p = u (powered only while producing)', 'p = 1 (powered all year)'],
      [['Cost per million output tokens', dollars(lowU.costPerMtok), dollars(highP.costPerMtok)],
       ['Energy cost per year', dollars(lowU.energyCostPerYear), dollars(highP.energyCostPerYear)],
       ['Energy, kWh per year', grouped(lowU.energyKWhPerYear), grouped(highP.energyKWhPerYear)]],
      1));
    out.appendChild(el('p', 'Common to both: ' + grouped(lowU.tokensPerYear) + ' output tokens per ' +
      'year at u = ' + inputs.u + ', and capital of ' + dollars(lowU.capitalPerYear) + ' per year over ' +
      inputs.amortizationYears + ' years. A real deployment sits between the two columns, ' +
      'because p is at least u.', 'muted'));

    var api = apiPrice();
    if (api !== null) {
      var rows = [];
      [['powered only while producing (p = u)', 'equalsU'], ['powered all year (p = 1)', 'always']]
        .forEach(function (pair) {
          var be;
          var text;
          try {
            be = ownedBreakEven(Object.assign({ apiPricePerMtok: api, powered: pair[1] }, withoutUtilization(inputs)));
          } catch (error) {
            rows.push([pair[0], 'cannot be calculated: ' + error.message]);
            return;
          }
          if (be.utilization === null) {
            text = 'none: the API price is at or below the energy cost per token';
          } else if (be.reachable) {
            text = 'u = ' + plain(be.utilization, 3);
          } else {
            text = 'not reachable: would need u = ' + plain(be.utilization, 3) + ', above 1';
          }
          rows.push([pair[0], text]);
        });
      out.appendChild(table('Break-even utilization against ' + dollars(api) + ' per million output tokens (floor)',
        ['Assumption', 'Owned hardware matches the API price at'], rows, 99));
    } else {
      apiPriceNote(out);
    }
    renderSensitivity(inputs);
  }

  function withoutUtilization(inputs) {
    var copy = {};
    Object.keys(inputs).forEach(function (key) { if (key !== 'u') { copy[key] = inputs[key]; } });
    return copy;
  }

  // ---- sensitivity strip -------------------------------------------------------------------

  var STRIP_AXES = [
    { axis: 'pue', input: 's-pue', hint: 's-pue-hint', title: 'PUE', format: function (v) { return String(v); } },
    { axis: 'tariff', input: 's-tariff', hint: 's-tariff-hint', title: 'Tariff, dollars per kWh', format: function (v) { return '$' + v; } },
    { axis: 'amortizationYears', input: 's-years', hint: 's-years-hint', title: 'Amortization, years', format: function (v) { return String(v); } }
  ];

  function renderSensitivity(inputs) {
    var out = byId('s-results');
    clear(out);
    STRIP_AXES.forEach(function (axis) {
      var parsed = parseValueList(byId(axis.input).value);
      if (parsed.error) {
        var box = el('div', null, 'error');
        box.appendChild(el('p', axis.title + ': ' + parsed.error + '.'));
        out.appendChild(box);
        return;
      }
      try {
        var rows = sensitivityStrip(inputs, axis.axis, parsed.values).map(function (row) {
          return [axis.format(row.value), dollars(row.pEqualsU.costPerMtok), dollars(row.pEqualsOne.costPerMtok)];
        });
        out.appendChild(table(axis.title + ': cost per million output tokens (floor)',
          [axis.title, 'p = u', 'p = 1'], rows, 1));
        if (parsed.truncated) {
          out.appendChild(el('p', axis.title + ': only the first ' + MAX_SENSITIVITY_VALUES +
            ' values are used; the rest of the list is ignored.', 'muted'));
        }
      } catch (error) {
        var errBox = el('div', null, 'error');
        errBox.appendChild(el('p', axis.title + ': ' + friendly(error.message) + '.'));
        out.appendChild(errBox);
      }
    });
  }

  function fillStripDefaults() {
    STRIP_AXES.forEach(function (axis) {
      byId(axis.input).value = SENSITIVITY_DEFAULTS[axis.axis].values.join(', ');
      byId(axis.hint).textContent = SENSITIVITY_DEFAULTS[axis.axis].note;
    });
  }

  // ---- rental ------------------------------------------------------------------------------

  var SATURATED_NOTE = 'Throughput is a saturated-batch benchmark figure, so a real request pattern ' +
    'costs more per token than this.';

  function renderMetered() {
    var out = byId('m-results');
    var collected = collect({ hourlyRate: 'm-rate', throughputPerAccelerator: 'm-tps' });
    if (!collected.values) { showNeeds(out, collected); return; }
    var result;
    try {
      result = meteredCost(collected.values);
    } catch (error) {
      showError(out, error.message);
      return;
    }
    clear(out);
    out.appendChild(table('Metered rental',
      ['Quantity', 'Value'],
      [['Cost per million output tokens', dollars(result.costPerMtok)],
       ['Depends on utilization?', 'No']], 1));
    var api = apiPrice();
    if (api !== null) {
      var times = ratioText(result.costPerMtok, api);
      if (times === null) {
        out.appendChild(el('p', 'The API price you entered (' + api + ' per million output tokens) is too small to ' +
          'compare with: the ratio is too large to show. A metered rental has no break-even utilization.'));
      } else {
        out.appendChild(el('p', 'This is ' + times + ' times the API price you entered (' +
          dollars(api) + ' per million output tokens). A metered rental has no break-even utilization.'));
      }
    } else {
      apiPriceNote(out);
    }
    out.appendChild(el('p', SATURATED_NOTE, 'muted'));
  }

  function renderCommitted() {
    var out = byId('c-results');
    var collected = collect({ hourlyRate: 'c-rate', throughputPerAccelerator: 'c-tps', u: 'c-u' });
    if (!collected.values) { showNeeds(out, collected); return; }
    var result;
    try {
      result = committedCost(collected.values);
    } catch (error) {
      showError(out, error.message);
      return;
    }
    clear(out);
    out.appendChild(table('Committed rental',
      ['Quantity', 'Value'],
      [['Cost per million output tokens at u = ' + collected.values.u, dollars(result.costPerMtok)],
       ['Cost at u = 1 (fully used)', dollars(meteredCost(collected.values).costPerMtok)]], 1));
    var api = apiPrice();
    if (api !== null) {
      var be = null;
      try {
        be = committedBreakEven({
          hourlyRate: collected.values.hourlyRate,
          throughputPerAccelerator: collected.values.throughputPerAccelerator,
          apiPricePerMtok: api
        });
      } catch (error) {
        showPartProblem(out, 'Break-even', error);
      }
      if (be !== null) {
        var text = be.reachable
          ? 'Break-even utilization against ' + dollars(api) + ': u = ' + plain(be.utilization, 3) + '.'
          : 'Break-even against ' + dollars(api) + ' is not reachable: it would need u = ' +
            plain(be.utilization, 3) + ', above 1, so a fully used committed rental still costs more than the API price.';
        out.appendChild(el('p', text));
      }
    } else {
      apiPriceNote(out);
    }
    out.appendChild(el('p', SATURATED_NOTE, 'muted'));
  }

  // ---- start-up ----------------------------------------------------------------------------

  function renderAll() {
    safely('stale-banner', renderStaleBanner);
    safely('o-results', renderOwned, ['s-results']);
    safely('m-results', renderMetered);
    safely('c-results', renderCommitted);
  }

  function init() {
    fillPresetSelect('o-tariff-preset', 'tariff');
    fillPresetSelect('o-pue-preset', 'pue');
    wirePreset('tariff', 'o-tariff-preset', 'o-tariff', 'o-tariff-source', renderAll);
    wirePreset('pue', 'o-pue-preset', 'o-pue', 'o-pue-source', renderAll);
    fillStripDefaults();
    renderPresetTable();

    ['api-price', 'o-tps', 'o-acc', 'o-price', 'o-years', 'o-tdp', 'o-u', 's-pue', 's-tariff', 's-years',
      'm-rate', 'm-tps', 'c-rate', 'c-tps', 'c-u'].forEach(function (id) {
      byId(id).addEventListener('input', renderAll);
    });
    renderAll();
  }

  init();
}());
