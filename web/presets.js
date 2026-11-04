// Presets for the self-host versus API calculator (Part 1.2).
//
// Every value carries its source URL, an as-of date (the day it was read), a tier, and a shelf
// life in days, like Part 1.1's price rows. Tiers (PLAN.md, "Standards every app shares"):
// A is verified against the primary source, B is a named credible secondary source or a primary
// source read through a copy, C is a single contested source and is shown with a warning. Tier X
// (unverifiable) is not shipped.
//
// kind 'published': a figure published by a source; it goes stale when its as-of date is older
//   than its shelf life.
// kind 'scenario': a setting used to reproduce a published analysis (Brief 04, section 8.2). It
//   is not a market figure, so it has no stale clock (shelf_life_days is null) and the page
//   labels it a scenario.
//
// This is a classic script, not an ES module. The guard on the last lines exports its names when
// Node loads it, for the tests.

var PRESETS = {
  // Electricity tariff, US dollars per kWh.
  tariff: [
    {
      id: 'eia-industrial-2026-08',
      label: 'US industrial average, August 2026 (preliminary)',
      value: 0.0964,
      kind: 'published',
      source_url: 'https://www.eia.gov/electricity/monthly/epm_table_grapher.php?t=epmt_5_6_a',
      as_of: '2026-11-04',
      tier: 'A',
      shelf_life_days: 35,
      note: 'EIA Electric Power Monthly, Table 5.6.A, U.S. Total, Industrial: 9.64 cents per ' +
        'kWh. EIA marks 2026 values preliminary. Data release 2026-10-23; next release ' +
        '2026-11-24. Read from the page itself on 2026-11-02 and again on 2026-11-04.'
    },
    {
      id: 'brief04-industrial-2026-06',
      label: 'Brief 04 scenario: US industrial average, June 2026',
      value: 0.0917,
      kind: 'scenario',
      source_url: 'https://www.eia.gov/electricity/monthly/archive/august2026.zip',
      as_of: '2026-11-04',
      tier: 'A',
      shelf_life_days: null,
      note: 'The tariff Brief 04, section 5.2 prints (9.17 cents per kWh, June 2026 data, ' +
        'released 2026-08-26 according to the paper). Read on 2026-11-04 in EIA\'s own August ' +
        '2026 issue of the Electric Power Monthly (back issues, a ZIP of data tables), Table ' +
        '5.6.A, U.S. Total, Industrial, June 2026: 9.17. EIA marked those values preliminary, ' +
        'and a later issue may revise them; later issues were not checked. EIA\'s current page ' +
        'shows August 2026 only. Use it to reproduce the paper\'s section 8.2 table.'
    }
  ],

  // Power usage effectiveness: total facility energy divided by IT equipment energy.
  pue: [
    {
      id: 'brief04-1.2',
      label: 'Brief 04 scenario: hyperscale',
      value: 1.2,
      kind: 'scenario',
      source_url: 'https://eta-publications.lbl.gov/sites/default/files/lbnl-1005775_v2.pdf',
      as_of: '2026-11-04',
      tier: 'A',
      shelf_life_days: null,
      note: 'The PUE Brief 04, section 8.2 uses. The 2016 national laboratory report ' +
        '(LBNL-1005775), Table 4 (PDF page 50), gives 1.2 for hyperscale data centers and ' +
        'describes its PUE values as assumed for each data center size, not measured. Read in ' +
        'the publisher\'s own PDF on 2026-11-04.'
    },
    {
      id: 'uptime-2026-average',
      label: 'Survey industry average, 2026',
      value: 1.52,
      kind: 'published',
      source_url: 'https://datacenter.uptimeinstitute.com/rs/711-RIA-145/images/UptimeInstitute.GlobalDataCenterSurvey.2026.pdf?version=0',
      as_of: '2026-11-04',
      tier: 'A',
      shelf_life_days: 365,
      note: 'Uptime Institute Global Data Center Survey 2026 (Keynote Report 209, July 2026), ' +
        'the "2026 industry average PUE" of respondents, Figure 2 (PDF page 7). The 2025 report ' +
        'calls its figure a weighted average; whether the two are the same measure is not ' +
        'stated. Read in the publisher\'s public PDF on 2026-11-04.'
    },
    {
      id: 'uptime-2026-largest',
      label: 'Survey: respondents\' largest data centers, 2026',
      value: 1.45,
      kind: 'published',
      source_url: 'https://datacenter.uptimeinstitute.com/rs/711-RIA-145/images/UptimeInstitute.GlobalDataCenterSurvey.2026.pdf?version=0',
      as_of: '2026-11-04',
      tier: 'A',
      shelf_life_days: 365,
      note: 'Same 2026 report, PDF page 8: the average annual PUE of respondents\' largest data ' +
        'centers, which may differ from the one they work in. Read on 2026-11-04.'
    },
    {
      id: 'uptime-2025-average',
      label: 'Survey average, 2025',
      value: 1.54,
      kind: 'published',
      source_url: 'https://datacenter.uptimeinstitute.com/rs/711-RIA-145/images/2025.Annual.Survey.Report.pdf?version=0',
      as_of: '2026-11-04',
      tier: 'A',
      shelf_life_days: 365,
      note: 'Uptime Institute Global Data Center Survey 2025 (Keynote Report 180, July 2025), ' +
        'weighted average annual PUE of respondents, Figure 2 (PDF page 7). Read in the ' +
        'publisher\'s public PDF on 2026-11-04. A newer survey is listed above.'
    },
    {
      id: 'uptime-2025-newer',
      label: 'Survey: facilities under five years old, 2025',
      value: 1.48,
      kind: 'published',
      source_url: 'https://datacenter.uptimeinstitute.com/rs/711-RIA-145/images/2025.Annual.Survey.Report.pdf?version=0',
      as_of: '2026-11-04',
      tier: 'A',
      shelf_life_days: 365,
      note: 'Same 2025 report, PDF page 8: facilities commissioned within five years of the ' +
        'survey. Read on 2026-11-04.'
    },
    {
      id: 'uptime-2025-20mw',
      label: 'Survey: 20 MW and above, 2025',
      value: 1.44,
      kind: 'published',
      source_url: 'https://datacenter.uptimeinstitute.com/rs/711-RIA-145/images/2025.Annual.Survey.Report.pdf?version=0',
      as_of: '2026-11-04',
      tier: 'A',
      shelf_life_days: 365,
      note: 'Same 2025 report, PDF page 8: data centers of 20 MW and above. Read on 2026-11-04.'
    }
  ]
};

// Values the sensitivity strip sweeps. The PUE and tariff values are the presets above. The
// amortization steps are illustrative: no source, chosen to show direction (Brief 04 uses 5).
var SENSITIVITY_DEFAULTS = {
  pue: {
    values: [1.2, 1.45, 1.52],
    note: 'The Brief 04 scenario and two 2026 survey figures (see the preset sources).'
  },
  tariff: {
    values: [0.0917, 0.0964],
    note: 'The Brief 04 scenario tariff and the current EIA preset, dollars per kWh.'
  },
  amortizationYears: {
    values: [3, 5, 7],
    note: 'Illustrative steps, not sourced; Brief 04 uses 5 years.'
  }
};

function parseIsoDate(text) {
  if (typeof text !== 'string') { throw new TypeError('date must be text in YYYY-MM-DD form'); }
  var match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (!match) { throw new RangeError('not a YYYY-MM-DD date: ' + text); }
  var year = Number(match[1]);
  var month = Number(match[2]);
  var day = Number(match[3]);
  var ms = Date.UTC(year, month - 1, day);
  var check = new Date(ms);
  if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 ||
      check.getUTCDate() !== day) {
    throw new RangeError('not a calendar date: ' + text);
  }
  return ms;
}

// Whole calendar days from one YYYY-MM-DD date to another (negative if the second is earlier).
function daysBetween(fromIso, toIso) {
  return Math.round((parseIsoDate(toIso) - parseIsoDate(fromIso)) / 86400000);
}

// Age and stale state of a preset on a given day. A value is stale when its age in days is
// greater than its shelf life; exactly at the shelf life is not stale. A scenario preset has no
// stale clock. An as-of date after today is reported as future.
function presetStatus(preset, todayIso) {
  var ageDays = daysBetween(preset.as_of, todayIso);
  var scenario = preset.kind === 'scenario';
  var shelf = preset.shelf_life_days;
  return {
    ageDays: ageDays,
    shelfLifeDays: shelf,
    scenario: scenario,
    future: ageDays < 0,
    stale: !scenario && typeof shelf === 'number' && ageDays > shelf
  };
}

// Returns a list of problems with a preset (empty when it is complete), all reported together.
function validatePreset(preset, todayIso) {
  var problems = [];
  if (typeof preset.id !== 'string' || preset.id === '') { problems.push('id is required'); }
  if (typeof preset.label !== 'string' || preset.label === '') { problems.push('label is required'); }
  if (typeof preset.value !== 'number' || !isFinite(preset.value)) {
    problems.push('value must be a finite number');
  }
  if (preset.kind !== 'published' && preset.kind !== 'scenario') {
    problems.push("kind must be 'published' or 'scenario'");
  }
  if (typeof preset.source_url !== 'string' || !/^https?:\/\/\S+$/.test(preset.source_url)) {
    problems.push('source_url must be an http or https URL');
  }
  try {
    if (daysBetween(preset.as_of, todayIso) < 0) { problems.push('as_of is later than today'); }
  } catch (error) {
    problems.push('as_of must be a YYYY-MM-DD date');
  }
  if (preset.tier !== 'A' && preset.tier !== 'B' && preset.tier !== 'C') {
    problems.push('tier must be A, B, or C (tier X is not shipped)');
  }
  var shelf = preset.shelf_life_days;
  var shelfOk = typeof shelf === 'number' && isFinite(shelf) && shelf > 0 && Math.floor(shelf) === shelf;
  if (preset.kind === 'scenario') {
    if (shelf !== null && !shelfOk) {
      problems.push('shelf_life_days must be null or a positive whole number');
    }
  } else if (!shelfOk) {
    problems.push('shelf_life_days must be a positive whole number');
  }
  return problems;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    PRESETS: PRESETS,
    SENSITIVITY_DEFAULTS: SENSITIVITY_DEFAULTS,
    daysBetween: daysBetween,
    presetStatus: presetStatus,
    validatePreset: validatePreset
  };
}
