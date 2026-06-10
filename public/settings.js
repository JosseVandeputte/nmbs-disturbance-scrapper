let pref = 'system';
try { pref = localStorage.getItem('theme') || 'system'; } catch (e) {}

document.querySelectorAll('input[name="theme"]').forEach((radio) => {
  radio.checked = radio.value === pref;
  radio.addEventListener('change', () => {
    if (radio.checked) window.__setTheme(radio.value);
  });
});
