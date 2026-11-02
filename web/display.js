// Display options: theme, contrast, and font. A classic script (no modules, so it works from a
// local file). It makes no network request. It stores one key, "display-options", holding the
// three choices, and the page works with storage blocked.
(function () {
  var KEY = 'display-options';
  var root = document.documentElement;
  var allowed = {
    theme: ['system', 'light', 'dark'],
    contrast: ['standard', 'high'],
    font: ['standard', 'atkinson']
  };
  var state = {
    theme: 'system',
    font: 'standard',
    contrast: (window.matchMedia && window.matchMedia('(prefers-contrast: more)').matches) ? 'high' : 'standard'
  };

  try {
    var saved = JSON.parse(window.localStorage.getItem(KEY) || '{}');
    Object.keys(allowed).forEach(function (k) {
      if (allowed[k].indexOf(saved[k]) !== -1) { state[k] = saved[k]; }
    });
  } catch (e) { /* storage blocked or unreadable: keep the defaults */ }

  function apply() {
    Object.keys(state).forEach(function (k) { root.setAttribute('data-' + k, state[k]); });
    Array.prototype.forEach.call(document.querySelectorAll('[data-display-option]'), function (b) {
      b.setAttribute('aria-pressed', String(state[b.dataset.displayOption] === b.dataset.value));
    });
  }

  document.addEventListener('click', function (e) {
    var b = e.target.closest && e.target.closest('[data-display-option]');
    if (!b || !allowed[b.dataset.displayOption] || allowed[b.dataset.displayOption].indexOf(b.dataset.value) === -1) { return; }
    state[b.dataset.displayOption] = b.dataset.value;
    apply();
    try { window.localStorage.setItem(KEY, JSON.stringify(state)); } catch (err) { /* not remembered */ }
  });

  apply();
})();
