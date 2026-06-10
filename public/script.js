const FN = '/.netlify/functions/disturbances';

const dateSelect  = document.getElementById('dateSelect');
const results     = document.getElementById('results');
const summary     = document.getElementById('summary');
const filterInput = document.getElementById('filter');
const filterRow   = document.getElementById('filterRow');
const prevBtn     = document.getElementById('prevDay');
const nextBtn     = document.getElementById('nextDay');

const REFRESH_MS = 2 * 60 * 1000;

const state = {
  dates: [],      // available days, newest first
  date: null,
  records: [],
  lastPolled: null,
  lastJSON: '',
};

let loadSeq = 0; // guards against out-of-order responses when switching dates quickly

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

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

function fmtDur(ms) {
  if (!(ms > 0)) return null;
  const m = Math.round(ms / 60000);
  if (m < 1) return 'minder dan 1 min';
  if (m < 60) return m + ' min';
  const h = Math.floor(m / 60), rest = m % 60;
  return h + ' u' + (rest ? ' ' + rest + ' min' : '');
}

// "lijn 50A" / "lijnen 36" mentions in title + description, shown as chips
function lineTags(r) {
  const text = (r.title || '') + ' ' + (r.description || '');
  const tags = new Set();
  const re = /\blijn(?:en)?\s+(\d{1,3}[A-Z]?)/gi;
  let m;
  while ((m = re.exec(text))) tags.add(m[1].toUpperCase());
  return [...tags].slice(0, 4);
}

function durationLabel(r) {
  const start = Date.parse(r.firstSeen);
  if (r.active && state.date === todayKey()) {
    const d = fmtDur(Date.now() - start);
    return d ? 'al ' + d + ' bezig' : null;
  }
  const d = fmtDur(Date.parse(r.lastSeen) - start);
  if (r.carriedOver) return 'liep door na middernacht' + (d ? ' (±' + d + ' die dag)' : '');
  if (!r.active && d) return 'duurde ±' + d;
  return null;
}

async function loadDates() {
  try {
    const res = await fetch(FN);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const { dates } = await res.json();
    dateSelect.innerHTML = '';
    state.dates = Array.isArray(dates) ? dates : [];
    if (!state.dates.length) {
      dateSelect.innerHTML = '<option value="">nog geen data</option>';
      return null;
    }
    for (const d of state.dates) {
      const o = document.createElement('option');
      o.value = d; o.textContent = d;
      dateSelect.appendChild(o);
    }
    return state.dates[0];
  } catch (e) {
    console.error('loadDates failed:', e);
    dateSelect.innerHTML = '<option value="">fout bij laden</option>';
    results.innerHTML = '<p class="state-msg">Kan de functie niet bereiken. Draait <code>netlify dev</code>?</p>';
    return null;
  }
}

async function loadDay(date, silent) {
  const seq = ++loadSeq;
  if (!date) {
    results.innerHTML = '<p class="state-msg">Geen datum geselecteerd.</p>';
    summary.textContent = '';
    filterRow.hidden = true;
    return;
  }
  if (!silent) results.innerHTML = '<p class="state-msg">Laden…</p>';
  try {
    const res = await fetch(FN + '?date=' + encodeURIComponent(date));
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const payload = await res.json();
    if (seq !== loadSeq) return;

    // payload is { records, lastPolled }; tolerate the old bare-array shape
    const records = Array.isArray(payload) ? payload : (payload.records || []);
    const lastPolled = Array.isArray(payload) ? null : (payload.lastPolled || null);

    const jsonStr = JSON.stringify(records);
    const unchanged = silent && date === state.date && jsonStr === state.lastJSON;
    state.date = date;
    state.records = records;
    state.lastPolled = lastPolled;
    state.lastJSON = jsonStr;
    if (!unchanged) render(silent);
  } catch (e) {
    if (seq !== loadSeq) return;
    if (silent) return; // background refresh failed: keep the current view
    console.error('loadDay failed:', e);
    results.innerHTML = '<p class="state-msg">Kon geen data laden.</p>';
    summary.textContent = '';
    filterRow.hidden = true;
  }
}

function renderEntry(r) {
  const changelog = (r.history || []).map(h =>
    '<div class="change">' +
      '<time>' + esc(fmtFull(h.timestamp)) + '</time>' +
      '<span class="field">' + esc(h.field) + '</span>: ' +
      '<span class="old">'   + esc(h.oldValue == null ? '—' : h.oldValue) + '</span> → ' +
      '<span class="new">'   + esc(h.newValue)  + '</span>' +
    '</div>'
  ).join('');

  const historyBlock = changelog
    ? '<details class="history"><summary>' +
        r.history.length + (r.history.length === 1 ? ' wijziging' : ' wijzigingen') +
      '</summary>' + changelog + '</details>'
    : '';

  const chips = lineTags(r).map(t => '<span class="chip">lijn ' + esc(t) + '</span>').join('');
  const dur = durationLabel(r);

  return (
    '<article class="log-entry ' + (r.active ? '' : 'inactive') + '" data-id="' + esc(r.id) + '">' +
      '<div class="entry-time">' + esc(fmtHour(r.firstSeen)) + '</div>' +
      '<div class="entry-content">' +
        '<div class="entry-head">' +
          '<h2>' + esc(r.title) + '</h2>' +
          (chips ? '<span class="chips">' + chips + '</span>' : '') +
        '</div>' +
        '<p class="desc">' + esc(r.description) + '</p>' +
        '<div class="times">' +
          '<span>gemeld ' + esc(fmtFull(r.firstSeen)) + '</span>' +
          '<span>update ' + esc(fmtFull(r.lastSeen))  + '</span>' +
          (dur ? '<span class="duration">' + esc(dur) + '</span>' : '') +
        '</div>' +
        historyBlock +
      '</div>' +
    '</article>'
  );
}

function renderGroup(key, label, recs, open) {
  return (
    '<details class="group" data-key="' + key + '"' + (open ? ' open' : '') + '>' +
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

// Snapshot/restore which <details> are open, so silent refreshes and filter
// keystrokes don't collapse what the user expanded.
function captureOpenState() {
  if (!results.querySelector('.group')) return null;
  const groups = new Set();
  results.querySelectorAll('details.group[open]').forEach(g => groups.add(g.dataset.key));
  const histories = new Set();
  results.querySelectorAll('article[data-id] details.history[open]').forEach(d =>
    histories.add(d.closest('article').dataset.id));
  return { groups, histories };
}

function restoreOpenState(snap) {
  if (!snap) return;
  results.querySelectorAll('details.group').forEach(g => { g.open = snap.groups.has(g.dataset.key); });
  results.querySelectorAll('article[data-id]').forEach(a => {
    const d = a.querySelector('details.history');
    if (d) d.open = snap.histories.has(a.dataset.id);
  });
}

function render(preserveOpen) {
  const all = state.records;
  const date = state.date;
  const snap = preserveOpen ? captureOpenState() : null;

  if (!Array.isArray(all) || !all.length) {
    summary.innerHTML = '';
    filterRow.hidden = true;
    const note = state.lastPolled
      ? ' Laatst gecontroleerd om ' + esc(fmtHour(state.lastPolled)) + '.'
      : ' Er is voor deze dag (nog) geen data van de scraper.';
    results.innerHTML = '<p class="state-msg">Geen storingen geregistreerd op ' + esc(date) + '.' + note + '</p>';
    return;
  }

  filterRow.hidden = false;

  const q = (filterInput.value || '').trim().toLowerCase();
  const records = q
    ? all.filter(r => ((r.title || '') + ' ' + (r.description || '')).toLowerCase().includes(q))
    : all;

  const byTime = (a, b) => String(a.firstSeen).localeCompare(String(b.firstSeen));
  const activeRecs   = records.filter(r =>  r.active).sort(byTime);
  const carriedRecs  = records.filter(r => !r.active &&  r.carriedOver).sort(byTime);
  const resolvedRecs = records.filter(r => !r.active && !r.carriedOver).sort(byTime);

  // Day statistics over the full (unfiltered) day
  const durations = all
    .filter(r => !r.active)
    .map(r => Date.parse(r.lastSeen) - Date.parse(r.firstSeen))
    .filter(ms => ms > 0);
  const avg = durations.length ? fmtDur(durations.reduce((a, b) => a + b, 0) / durations.length) : null;
  const max = durations.length ? fmtDur(Math.max(...durations)) : null;

  const nActive  = all.filter(r => r.active).length;
  const nCarried = all.filter(r => !r.active && r.carriedOver).length;
  const nDone    = all.length - nActive - nCarried;

  summary.innerHTML =
    '<b>' + all.length + '</b> ' + (all.length === 1 ? 'melding' : 'meldingen') +
    ' - <b>' + nActive + '</b> nog actief' +
    ' - <b>' + nDone + '</b> opgelost' +
    (nCarried ? ' - <b>' + nCarried + '</b> doorlopend' : '') +
    (avg ? ' - gem. duur <b>' + avg + '</b>' : '') +
    (max ? ' - langste <b>' + max + '</b>' : '') +
    (q ? ' - filter: <b>' + records.length + '</b> zichtbaar' : '') +
    (date === todayKey() && state.lastPolled ? ' - bijgewerkt om <b>' + esc(fmtHour(state.lastPolled)) + '</b>' : '');

  if (!records.length) {
    results.innerHTML = '<p class="state-msg">Geen meldingen die overeenkomen met de filter.</p>';
    return;
  }

  results.innerHTML =
    (activeRecs.length   ? renderGroup('active',   'Actief',                      activeRecs,   true)  : '') +
    (carriedRecs.length  ? renderGroup('carried',  'Doorlopend na middernacht',   carriedRecs,  false) : '') +
    (resolvedRecs.length ? renderGroup('resolved', 'Opgelost',                    resolvedRecs, false) : '');

  restoreOpenState(snap);
}

/* ── Date selection, URL state, prev/next ───────────────── */

function updateNavButtons() {
  const i = state.dates.indexOf(dateSelect.value);
  prevBtn.disabled = i === -1 || i >= state.dates.length - 1; // older
  nextBtn.disabled = i <= 0;                                  // newer
}

function selectDate(date) {
  dateSelect.value = date;
  updateNavButtons();
  const u = new URL(location);
  u.searchParams.set('date', date);
  history.replaceState(null, '', u);
  loadDay(date, false);
}

dateSelect.addEventListener('change', () => selectDate(dateSelect.value));

prevBtn.addEventListener('click', () => {
  const i = state.dates.indexOf(dateSelect.value);
  if (i !== -1 && i < state.dates.length - 1) selectDate(state.dates[i + 1]);
});

nextBtn.addEventListener('click', () => {
  const i = state.dates.indexOf(dateSelect.value);
  if (i > 0) selectDate(state.dates[i - 1]);
});

/* ── Filter ──────────────────────────────────────────────── */

let filterTimer = null;
filterInput.addEventListener('input', () => {
  clearTimeout(filterTimer);
  filterTimer = setTimeout(() => render(true), 150);
});

/* ── Auto-refresh (today only, visible tab only) ─────────── */

function maybeRefresh() {
  if (document.visibilityState !== 'visible') return;
  if (!state.date || state.date !== todayKey()) return;
  loadDay(state.date, true);
}

setInterval(maybeRefresh, REFRESH_MS);
document.addEventListener('visibilitychange', maybeRefresh);

/* ── Init ────────────────────────────────────────────────── */

(async () => {
  const latest = await loadDates();
  const urlDate = new URLSearchParams(location.search).get('date');
  const initial = urlDate && state.dates.includes(urlDate) ? urlDate : latest;
  if (initial) selectDate(initial);
  else loadDay(null, false);
})();
