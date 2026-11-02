// Self-host versus API cost model, owned hardware only (Part 1.2, session s07).
//
// The arithmetic is the one printed in Brief 04, section 8.1, with u the fraction of the year
// producing tokens and p the fraction of the year powered:
//
//   tokens_per_year  = throughput_per_accelerator x accelerators x 3600 x 8760 x u
//   capital_per_year = unit_price x accelerators / amortization_years
//   energy_kWh_year  = TDP_per_accelerator x accelerators / 1000 x 8760 x p
//   cost_per_Mtok    = 1e6 x (capital_per_year + energy_kWh_year x tariff x PUE) / tokens_per_year
//
// Every result is a floor: it leaves out host systems, networking, storage, redundancy, space,
// cooling capital, bandwidth, license compliance, operating labor, and safety maintenance.
//
// This is a classic script, not an ES module, so a page opened from a local file can load it.
// The guard on the last lines exports the functions when Node loads it, for the tests.

var SECONDS_PER_HOUR = 3600;
var HOURS_PER_YEAR = 8760;

var OWNED_INPUT_NAMES = [
  'throughputPerAccelerator', 'accelerators', 'unitPrice', 'amortizationYears',
  'tdpWatts', 'tariff', 'pue', 'u', 'p'
];

function requireFiniteNumber(inputs, name) {
  var value = inputs[name];
  if (typeof value !== 'number' || !isFinite(value)) {
    throw new TypeError(name + ' must be a finite number');
  }
  return value;
}

// Checks every input and returns the numbers. Throws TypeError for a missing or non-numeric
// input and RangeError for a number outside its range. p has no default: the paper warns that
// assuming p = u is "the most favorable assumption available and is never true", so the caller
// must choose p, and p below u is refused.
function validateOwnedInputs(inputs) {
  if (inputs === null || typeof inputs !== 'object') {
    throw new TypeError('inputs must be an object');
  }
  var v = {};
  OWNED_INPUT_NAMES.forEach(function (name) { v[name] = requireFiniteNumber(inputs, name); });

  if (v.throughputPerAccelerator <= 0) {
    throw new RangeError('throughputPerAccelerator must be greater than 0');
  }
  if (v.accelerators < 1 || Math.floor(v.accelerators) !== v.accelerators) {
    throw new RangeError('accelerators must be a whole number of at least 1');
  }
  if (v.unitPrice < 0) { throw new RangeError('unitPrice must not be negative'); }
  if (v.amortizationYears <= 0) {
    throw new RangeError('amortizationYears must be greater than 0');
  }
  if (v.tdpWatts < 0) { throw new RangeError('tdpWatts must not be negative'); }
  if (v.tariff < 0) { throw new RangeError('tariff must not be negative'); }
  if (v.pue < 1) { throw new RangeError('pue must be at least 1'); }
  if (v.u <= 0 || v.u > 1) { throw new RangeError('u must be greater than 0 and at most 1'); }
  if (v.p > 1) { throw new RangeError('p must be at most 1'); }
  if (v.p < v.u) {
    throw new RangeError('p must not be below u: a machine cannot produce tokens while unpowered');
  }
  return v;
}

// Owned-hardware cost in dollars per million output tokens, as a floor.
// inputs: throughputPerAccelerator (tokens per second), accelerators (count), unitPrice (dollars
// per accelerator), amortizationYears, tdpWatts (per accelerator), tariff (dollars per kWh),
// pue, u, p.
function ownedCost(inputs) {
  var v = validateOwnedInputs(inputs);
  var tokensPerYear = v.throughputPerAccelerator * v.accelerators *
    SECONDS_PER_HOUR * HOURS_PER_YEAR * v.u;
  var capitalPerYear = v.unitPrice * v.accelerators / v.amortizationYears;
  var energyKWhPerYear = v.tdpWatts * v.accelerators / 1000 * HOURS_PER_YEAR * v.p;
  var energyCostPerYear = energyKWhPerYear * v.tariff * v.pue;
  return {
    label: 'floor',
    inputs: v,
    tokensPerYear: tokensPerYear,
    capitalPerYear: capitalPerYear,
    energyKWhPerYear: energyKWhPerYear,
    energyCostPerYear: energyCostPerYear,
    costPerMtok: 1e6 * (capitalPerYear + energyCostPerYear) / tokensPerYear
  };
}

// The two columns of the paper's section 8.2 table for one u: p = u (never idle powered) and
// p = 1 (powered all year). Takes the same inputs as ownedCost without p; a supplied p is an
// error, so this function cannot be used to set p below u.
function ownedCostRange(inputs) {
  if (inputs !== null && typeof inputs === 'object' && 'p' in inputs) {
    throw new TypeError('ownedCostRange chooses p itself; do not pass p');
  }
  var withP = function (p) {
    var copy = {};
    Object.keys(inputs).forEach(function (key) { copy[key] = inputs[key]; });
    copy.p = p;
    return copy;
  };
  if (inputs === null || typeof inputs !== 'object') {
    throw new TypeError('inputs must be an object');
  }
  var u = requireFiniteNumber(inputs, 'u');
  return {
    pEqualsU: ownedCost(withP(u)),
    pEqualsOne: ownedCost(withP(1))
  };
}

// ---------------------------------------------------------------------------------------------
// Rental routes (Brief 04, section 9). Hourly rates are dollars per accelerator-hour.
//
// A metered offer is billed for the hours used, so its cost per token does not depend on
// utilization. A committed offer is billed for the whole term whether used or not, so its cost
// per token scales with 1 / u like owned capital. They are separate functions on purpose: the
// paper records that putting them in one table, by dividing an hourly rate by a duty cycle,
// "treats an hourly rental as a year-long commitment". Throughput is the saturated-batch
// benchmark figure, so rental results inherit the arrival-rate problem named in sections 8.3
// and 9.2.

function validateRentalInputs(inputs) {
  if (inputs === null || typeof inputs !== 'object') {
    throw new TypeError('inputs must be an object');
  }
  var rate = requireFiniteNumber(inputs, 'hourlyRate');
  var throughput = requireFiniteNumber(inputs, 'throughputPerAccelerator');
  if (rate < 0) { throw new RangeError('hourlyRate must not be negative'); }
  if (throughput <= 0) { throw new RangeError('throughputPerAccelerator must be greater than 0'); }
  return { hourlyRate: rate, throughputPerAccelerator: throughput };
}

function rentalCostAtFullUse(v) {
  return 1e6 * v.hourlyRate / (v.throughputPerAccelerator * SECONDS_PER_HOUR);
}

// Metered rental, dollars per million output tokens. Takes no utilization: any u passed in the
// inputs is ignored, because metered cost does not depend on it.
function meteredCost(inputs) {
  var v = validateRentalInputs(inputs);
  return { label: 'metered', inputs: v, costPerMtok: rentalCostAtFullUse(v) };
}

// Committed rental, dollars per million output tokens, at utilization u in (0, 1].
function committedCost(inputs) {
  var v = validateRentalInputs(inputs);
  v.u = requireFiniteNumber(inputs, 'u');
  if (v.u <= 0 || v.u > 1) { throw new RangeError('u must be greater than 0 and at most 1'); }
  return { label: 'committed', inputs: v, costPerMtok: rentalCostAtFullUse(v) / v.u };
}

function requireApiPrice(inputs) {
  var api = requireFiniteNumber(inputs, 'apiPricePerMtok');
  if (api <= 0) { throw new RangeError('apiPricePerMtok must be greater than 0'); }
  return api;
}

// Utilization at which a committed rental costs the same per token as an API price.
// utilization above 1 is returned as computed but reachable is false: no use of the hardware
// can bring the committed cost down to the API price. Metered rental has no break-even
// utilization, because its cost does not depend on utilization.
function committedBreakEven(inputs) {
  var v = validateRentalInputs(inputs);
  var api = requireApiPrice(inputs);
  var utilization = rentalCostAtFullUse(v) / api;
  return { label: 'committed', utilization: utilization, reachable: utilization <= 1 };
}

// Utilization at which owned hardware costs the same per million tokens as an API price. Takes
// the owned inputs without u and p, plus apiPricePerMtok and powered:
//   'always'   p = 1, powered all year:            cost(u) = (C + E) / u
//   'equalsU'  p = u, powered only while producing: cost(u) = C / u + E
// where C and E are the capital and energy costs per million tokens at u = 1. With 'equalsU'
// there is no break-even when the API price is at or below E (utilization is null). The
// choice of powered is required, because it is the assumption the paper says is never true
// when set to p = u. The result is a floor, like every owned-hardware result.
function ownedBreakEven(inputs) {
  if (inputs === null || typeof inputs !== 'object') {
    throw new TypeError('inputs must be an object');
  }
  if ('u' in inputs || 'p' in inputs) {
    throw new TypeError('ownedBreakEven solves for u; do not pass u or p');
  }
  var api = requireApiPrice(inputs);
  if (typeof inputs.powered !== 'string') {
    throw new TypeError("powered must be 'always' or 'equalsU'");
  }
  if (inputs.powered !== 'always' && inputs.powered !== 'equalsU') {
    throw new RangeError("powered must be 'always' or 'equalsU'");
  }
  var atFullUse = {};
  OWNED_INPUT_NAMES.forEach(function (name) { atFullUse[name] = inputs[name]; });
  atFullUse.u = 1;
  atFullUse.p = 1;
  var full = ownedCost(atFullUse);
  var capital = 1e6 * full.capitalPerYear / full.tokensPerYear;
  var energy = 1e6 * full.energyCostPerYear / full.tokensPerYear;

  var utilization;
  if (inputs.powered === 'always') {
    utilization = (capital + energy) / api;
  } else if (api > energy) {
    utilization = capital / (api - energy);
  } else {
    utilization = null;
  }
  return {
    label: 'floor',
    powered: inputs.powered,
    utilization: utilization,
    reachable: utilization !== null && utilization <= 1
  };
}

// Sensitivity strip: the owned-hardware cost, p = u and p = 1, as one input varies and the others
// are held. inputs are the owned inputs including u and without p. axis is 'pue', 'tariff', or
// 'amortizationYears'. values is a non-empty array. Each row is
// { axis, value, pEqualsU, pEqualsOne }, the last two as ownedCost results (floors). A swept
// value the model rejects throws, as ownedCostRange does.
var SENSITIVITY_AXES = ['pue', 'tariff', 'amortizationYears'];

function sensitivityStrip(inputs, axis, values) {
  if (inputs === null || typeof inputs !== 'object') {
    throw new TypeError('inputs must be an object');
  }
  if (SENSITIVITY_AXES.indexOf(axis) === -1) {
    throw new RangeError('axis must be one of ' + SENSITIVITY_AXES.join(', '));
  }
  if (!Array.isArray(values)) { throw new TypeError('values must be an array'); }
  if (values.length === 0) { throw new RangeError('values must not be empty'); }
  return values.map(function (value) {
    var copy = {};
    Object.keys(inputs).forEach(function (key) { copy[key] = inputs[key]; });
    copy[axis] = value;
    var range = ownedCostRange(copy);
    return { axis: axis, value: value, pEqualsU: range.pEqualsU, pEqualsOne: range.pEqualsOne };
  });
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    SECONDS_PER_HOUR: SECONDS_PER_HOUR,
    HOURS_PER_YEAR: HOURS_PER_YEAR,
    validateOwnedInputs: validateOwnedInputs,
    ownedCost: ownedCost,
    ownedCostRange: ownedCostRange,
    meteredCost: meteredCost,
    committedCost: committedCost,
    committedBreakEven: committedBreakEven,
    ownedBreakEven: ownedBreakEven,
    sensitivityStrip: sensitivityStrip
  };
}
