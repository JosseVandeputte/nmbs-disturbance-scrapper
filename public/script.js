const FN = '/.netlify/functions/disturbances';
const dateSelect = document.getElementById('dateSelect');
const results    = document.getElementById('results');
const summary    = document.getElementById('summary');

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/[&<>"]/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;' }[c]));
}

function fmtFull(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('nl-BE', {
    day: '2-digit', month: 'short',
    hour: '2-digit', minute: '2-digit'
  });
}

function fmtHour(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('nl-BE', {
    hour: '2-digit', minute: '2-digit'
  });
}

async function loadDates() {
  try {
    const res = await fetch(FN);
    const { dates } = await res.json();
    dateSelect.innerHTML = '';
    if (!dates || !dates.length) {
      dateSelect.innerHTML = '<option value="">nog geen data</option>';
      return null;
    }
    for (const d of dates) {
      const o = document.createElement('option');
      o.value = d; o.textContent = d;
      dateSelect.appendChild(o);
    }
    return dates[0];
  } catch (e) {
    console.error('loadDates failed:', e);
    dateSelect.innerHTML = '<option value="">fout bij laden</option>';
    results.innerHTML = '<p class="state-msg">Kan de functie niet bereiken. Draait <code>netlify dev</code>?</p>';
    return null;
  }
}

async function loadDay(date) {
  if (!date) {
    results.innerHTML = '<p class="state-msg">Geen datum geselecteerd.</p>';
    summary.textContent = '';
    return;
  }
  results.innerHTML = '<p class="state-msg">Laden…</p>';
  try {
    const res = await fetch(FN + '?date=' + encodeURIComponent(date));
    const records = await res.json();
    render(records, date);
  } catch (e) {
    results.innerHTML = '<p class="state-msg">Kon geen data laden.</p>';
    summary.textContent = '';
  }
}

function renderEntry(r) {
  const changelog = (r.history || []).map(h =>
    '<div class="change">' +
      '<time>' + esc(fmtFull(h.timestamp)) + '</time>' +
      '<span class="field">' + esc(h.field) + '</span>: ' +
      '<span class="old">'   + esc(h.oldValue) + '</span> → ' +
      '<span class="new">'   + esc(h.newValue)  + '</span>' +
    '</div>'
  ).join('');

  const historyBlock = changelog
    ? '<details class="history"><summary>' +
        r.history.length + (r.history.length === 1 ? ' wijziging' : ' wijzigingen') +
      '</summary>' + changelog + '</details>'
    : '';

  return (
    '<article class="log-entry ' + (r.active ? '' : 'inactive') + '">' +
      '<div class="entry-time">' + esc(fmtHour(r.firstSeen)) + '</div>' +
      '<div class="entry-content">' +
        '<div class="entry-head">' +
          '<h2>' + esc(r.title) + '</h2>' +
        '</div>' +
        '<p class="desc">' + esc(r.description) + '</p>' +
        '<div class="times">' +
          '<span>gemeld ' + esc(fmtFull(r.firstSeen)) + '</span>' +
          '<span>update ' + esc(fmtFull(r.lastSeen))  + '</span>' +
        '</div>' +
        historyBlock +
      '</div>' +
    '</article>'
  );
}

function renderGroup(label, recs, open) {
  return (
    '<details class="group"' + (open ? ' open' : '') + '>' +
      '<summary class="group-header">' +
        '<span class="group-title">' + label + '</span>' +
        '<span class="group-right">' +
          '<span class="group-count">' + recs.length + '</span>' +
          '<span class="group-chevron">›</span>' +
        '</span>' +
      '</summary>' +
      '<div class="group-entries">' +
        recs.map(renderEntry).join('') +
      '</div>' +
    '</details>'
  );
}

function render(records, date) {
  if (!Array.isArray(records) || !records.length) {
    summary.innerHTML = '';
    results.innerHTML = '<p class="state-msg">Geen storingen geregistreerd op ' + esc(date) + '.</p>';
    return;
  }

  const byTime = (a, b) => a.firstSeen < b.firstSeen ? -1 : 1;
  const activeRecs   = records.filter(r =>  r.active).sort(byTime);
  const resolvedRecs = records.filter(r => !r.active).sort(byTime);

  summary.innerHTML =
    '<b>' + records.length + '</b> ' +
    (records.length === 1 ? 'melding' : 'meldingen') + ' - ' +
    '<b>' + activeRecs.length + '</b> nog actief - ' +
    '<b>' + resolvedRecs.length + '</b> opgelost';

  results.innerHTML =
    (activeRecs.length   ? renderGroup('Actief',   activeRecs,   true)  : '') +
    (resolvedRecs.length ? renderGroup('Opgelost', resolvedRecs, false) : '');
}

dateSelect.addEventListener('change', () => loadDay(dateSelect.value));

(async () => {
  const latest = await loadDates();
  if (latest) dateSelect.value = latest;
  loadDay(latest);
})();
