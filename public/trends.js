const STATS_FN  = '/.netlify/functions/stats?days=90';
const SEARCH_FN = '/.netlify/functions/search';

const tStats        = document.getElementById('tStats');
const chartDays     = document.getElementById('chartDays');
const chartWeekdays = document.getElementById('chartWeekdays');
const chartHours    = document.getElementById('chartHours');
const longestEl     = document.getElementById('longest');
const searchForm    = document.getElementById('searchForm');
const searchInput   = document.getElementById('searchInput');
const searchResults = document.getElementById('searchResults');

const WEEKDAYS = ['ma', 'di', 'wo', 'do', 'vr', 'za', 'zo'];
const WEEKDAYS_FULL = ['maandag', 'dinsdag', 'woensdag', 'donderdag', 'vrijdag', 'zaterdag', 'zondag'];

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/[&<>"]/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;' }[c]));
}

function fmtDur(ms) {
  if (!(ms > 0)) return null;
  const m = Math.round(ms / 60000);
  if (m < 1) return 'minder dan 1 min';
  if (m < 60) return m + ' min';
  const h = Math.floor(m / 60), rest = m % 60;
  return h + ' u' + (rest ? ' ' + rest + ' min' : '');
}

function fmtDate(iso) {
  return new Date(iso + 'T12:00:00Z').toLocaleDateString('nl-BE', { day: 'numeric', month: 'short' });
}

function fmtDayFull(iso) {
  return new Date(iso + 'T12:00:00Z').toLocaleDateString('nl-BE', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
  });
}

// Generic bar strip: items = [{label, value, tip, href}]
function barChart(items, opts) {
  const max = Math.max(1, ...items.map(i => i.value));
  const labelEvery = opts && opts.labelEvery ? opts.labelEvery : 1;
  return (
    '<div class="bars">' +
      items.map((it, idx) => {
        const h = Math.round((it.value / max) * 100);
        const inner =
          '<span class="bar-fill" style="height:' + Math.max(h, it.value ? 3 : 1) + '%"></span>' +
          '<span class="bar-label">' + (idx % labelEvery === 0 ? esc(it.label) : '') + '</span>';
        return it.href
          ? '<a class="bar" href="' + esc(it.href) + '">' + inner + '</a>'
          : '<span class="bar">' + inner + '</span>';
      }).join('') +
    '</div>'
  );
}

/* ── Hover tooltip on chart columns ──────────────────────── */

const chartTip = document.createElement('div');
chartTip.className = 'chart-tip';
chartTip.hidden = true;
document.body.appendChild(chartTip);

function positionTip(e) {
  const pad = 14;
  const rect = chartTip.getBoundingClientRect();
  let x = e.clientX + pad;
  let y = e.clientY - rect.height - pad;
  if (x + rect.width > window.innerWidth - 8) x = e.clientX - rect.width - pad;
  if (y < 8) y = e.clientY + pad;
  chartTip.style.left = x + 'px';
  chartTip.style.top = y + 'px';
}

function renderChartTip(lines) {
  chartTip.textContent = '';
  for (const line of lines) {
    const node = document.createElement(line.strong ? 'b' : 'span');
    if (line.className) node.className = line.className;
    node.textContent = line.text;
    chartTip.appendChild(node);
  }
}

// Renders bars into a container and wires up the shared tooltip.
function renderBars(container, items, opts) {
  container.innerHTML = barChart(items, opts);
  container.querySelectorAll('.bar').forEach((bar, i) => { bar._tip = items[i].tip; });

  container.addEventListener('mousemove', (e) => {
    const bar = e.target.closest('.bar');
    if (!bar || !bar._tip) { chartTip.hidden = true; return; }
    if (chartTip._tip !== bar._tip) {
      renderChartTip(bar._tip);
      chartTip._tip = bar._tip;
    }
    chartTip.hidden = false;
    positionTip(e);
  });
  container.addEventListener('mouseleave', () => { chartTip.hidden = true; });
}

function pct(value, total) {
  return total > 0 ? Math.round((value / total) * 100) + '%' : null;
}

function nMeldingen(n) {
  return n + ' ' + (n === 1 ? 'melding' : 'meldingen');
}

async function loadStats() {
  try {
    const res = await fetch(STATS_FN);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const stats = await res.json();

    const t = stats.totals || {};
    tStats.innerHTML =
      '<b>' + (t.disturbances || 0) + '</b> storingen over <b>' + (t.daysWithData || 0) + '</b> dagen' +
      (t.avgDuration ? ' - gem. duur <b>' + fmtDur(t.avgDuration) + '</b>' : '');

    const days = Array.isArray(stats.days) ? stats.days : [];
    if (!days.length) {
      chartDays.innerHTML = '<p class="state-msg">Nog geen data — de scraper moet eerst een paar dagen draaien.</p>';
      chartWeekdays.innerHTML = '';
      chartHours.innerHTML = '';
      longestEl.innerHTML = '';
      return;
    }

    const last30 = days.slice(-30);
    renderBars(chartDays, last30.map((d, i) => ({
      label: (i === 0 || i === last30.length - 1) ? fmtDate(d.date) : '',
      value: d.total,
      href: './?date=' + d.date,
      tip: [
        { text: fmtDayFull(d.date), strong: true },
        { text: nMeldingen(d.total) },
        ...(d.total
          ? [{ text: d.active + ' actief · ' + d.resolved + ' opgelost' + (d.carriedOver ? ' · ' + d.carriedOver + ' doorlopend' : '') }]
          : []),
        ...(d.avgDuration ? [{ text: 'gem. duur ' + (fmtDur(d.avgDuration) || '?') }] : []),
        ...(d.maxDuration ? [{ text: 'langste ' + (fmtDur(d.maxDuration) || '?') }] : []),
        { text: 'klik om deze dag te openen', className: 'tip-hint' },
      ],
    })));

    const byWeekday = stats.byWeekday || [];
    const wdTotal = byWeekday.reduce((a, b) => a + b, 0);
    renderBars(chartWeekdays, byWeekday.map((v, i) => ({
      label: WEEKDAYS[i],
      value: v,
      tip: [
        { text: WEEKDAYS_FULL[i], strong: true },
        { text: nMeldingen(v) },
        ...(pct(v, wdTotal) ? [{ text: pct(v, wdTotal) + ' van alle meldingen' }] : []),
      ],
    })));

    const byHour = stats.byHour || [];
    const hTotal = byHour.reduce((a, b) => a + b, 0);
    renderBars(chartHours, byHour.map((v, i) => ({
      label: String(i),
      value: v,
      tip: [
        { text: String(i).padStart(2, '0') + ':00 – ' + String((i + 1) % 24).padStart(2, '0') + ':00', strong: true },
        { text: nMeldingen(v) },
        ...(pct(v, hTotal) ? [{ text: pct(v, hTotal) + ' van alle meldingen' }] : []),
      ],
    })), { labelEvery: 6 });

    const longest = Array.isArray(stats.longest) ? stats.longest : [];
    longestEl.innerHTML = longest.length
      ? longest.map(l =>
          '<article class="search-hit">' +
            '<time><a href="./?date=' + esc(l.date) + '">' + esc(l.date) + '</a></time>' +
            '<h3>' + esc(l.title) + '</h3>' +
            '<p>duurde ±' + esc(fmtDur(l.duration) || '?') + '</p>' +
          '</article>'
        ).join('')
      : '<p class="state-msg">Nog geen afgeronde storingen.</p>';
  } catch (e) {
    console.error('loadStats failed:', e);
    tStats.textContent = '';
    chartDays.innerHTML = '<p class="state-msg">Kon de statistieken niet laden.</p>';
  }
}

async function runSearch(q) {
  searchResults.innerHTML = '<p class="state-msg">Zoeken…</p>';
  try {
    const res = await fetch(SEARCH_FN + '?q=' + encodeURIComponent(q));
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error || ('HTTP ' + res.status));
    }
    const data = await res.json();
    const hits = Array.isArray(data.results) ? data.results : [];
    if (!hits.length) {
      searchResults.innerHTML =
        '<p class="state-msg">Geen resultaten voor “' + esc(q) + '” in de laatste ' +
        (data.searchedDays || 0) + ' dagen.</p>';
      return;
    }
    searchResults.innerHTML =
      '<p class="search-count">' + hits.length + (hits.length === 1 ? ' resultaat' : ' resultaten') +
      (hits.length === 100 ? ' (max. bereikt)' : '') + '</p>' +
      hits.map(h => {
        const desc = String(h.description || '');
        return (
          '<article class="search-hit' + (h.active ? '' : ' inactive') + '">' +
            '<time><a href="./?date=' + esc(h.date) + '">' + esc(h.date) + '</a></time>' +
            '<h3>' + esc(h.title) + '</h3>' +
            '<p>' + esc(desc.length > 220 ? desc.slice(0, 220) + '…' : desc) + '</p>' +
          '</article>'
        );
      }).join('');
  } catch (e) {
    console.error('search failed:', e);
    searchResults.innerHTML = '<p class="state-msg">Zoeken mislukt: ' + esc(e.message) + '</p>';
  }
}

searchForm.addEventListener('submit', (ev) => {
  ev.preventDefault();
  const q = searchInput.value.trim();
  if (q.length < 2) {
    searchResults.innerHTML = '<p class="state-msg">Geef minstens 2 tekens in.</p>';
    return;
  }
  runSearch(q);
});

loadStats();
