// Applies the saved theme preference (light / dark / system) before first
// paint, so there's no flash of the wrong theme. Loaded blocking in <head>.
(function () {
  var media = window.matchMedia('(prefers-color-scheme: dark)');

  function readPref() {
    try { return localStorage.getItem('theme') || 'system'; } catch (e) { return 'system'; }
  }

  function apply(pref) {
    var dark = pref === 'dark' || (pref !== 'light' && media.matches);
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  }

  apply(readPref());

  media.addEventListener('change', function () {
    if (readPref() === 'system') apply('system');
  });

  // Used by the settings page.
  window.__setTheme = function (pref) {
    try { localStorage.setItem('theme', pref); } catch (e) {}
    apply(pref);
  };
})();
