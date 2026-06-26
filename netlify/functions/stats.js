// netlify/functions/stats.js
//
// Aggregated statistics over the last N days of stored disturbances.
//   GET /.netlify/functions/stats?days=90 -> {
//     rangeDays, days: [{date, total, active, resolved, carriedOver, avgDuration, maxDuration}],
//     byWeekday: [7], byHour: [24],  // counts by firstSeen, Europe/Brussels time
//     totals: { disturbances, daysWithData, avgDuration },
//     longest: [{date, title, duration}]
//   }
//
// Durations are lastSeen - firstSeen in ms, only for records no longer active.
// Responses are cached so the per-request blob reads stay cheap.

import { getStore } from '@netlify/blobs';

const MAX_DAYS = 92;
const DATE_INDEX_KEY = '__dates__';
const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
};

async function readDateKeys(store) {
  try {
    const index = await store.get(DATE_INDEX_KEY, { type: 'json' });
    if (Array.isArray(index)) {
      return index.filter((k) => /^\d{4}-\d{2}-\d{2}$/.test(k)).sort().reverse();
    }
  } catch {
    // Fall back to list() below.
  }

  const { blobs } = await store.list();
  return blobs
    .map((b) => b.key)
    .filter((k) => /^\d{4}-\d{2}-\d{2}$/.test(k))
    .sort()
    .reverse();
}

const brusselsFmt = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/Brussels',
  weekday: 'short',
  hour: '2-digit',
  hourCycle: 'h23',
});
const WEEKDAY_INDEX = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 };

function brusselsParts(iso) {
  const parts = brusselsFmt.formatToParts(new Date(iso));
  let weekday = null;
  let hour = null;
  for (const p of parts) {
    if (p.type === 'weekday') weekday = WEEKDAY_INDEX[p.value];
    if (p.type === 'hour') hour = parseInt(p.value, 10);
  }
  return { weekday, hour };
}

export default async (req) => {
  const url = new URL(req.url);
  let days = parseInt(url.searchParams.get('days'), 10);
  if (!Number.isFinite(days) || days < 1) days = 30;
  days = Math.min(days, MAX_DAYS);

  const headers = { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=900', ...SECURITY_HEADERS };
  const store = getStore({ name: 'disturbances', consistency: 'strong' });

  try {
    const keys = (await readDateKeys(store)).slice(0, days);

    const dayData = await Promise.all(
      keys.map(async (key) => {
        try {
          const records = await store.get(key, { type: 'json' });
          return [key, Array.isArray(records) ? records : []];
        } catch {
          return [key, []];
        }
      })
    );

    const byWeekday = new Array(7).fill(0);
    const byHour = new Array(24).fill(0);
    const perDay = [];
    const allDurations = [];
    const longestCandidates = [];

    for (const [date, records] of dayData) {
      let active = 0;
      let resolved = 0;
      let carriedOver = 0;
      const durations = [];

      for (const r of records) {
        if (r.active) active++;
        else if (r.carriedOver) carriedOver++;
        else resolved++;

        const start = Date.parse(r.firstSeen);
        const end = Date.parse(r.lastSeen);
        if (!r.active && end > start) {
          durations.push(end - start);
          allDurations.push(end - start);
          longestCandidates.push({ date, title: r.title, duration: end - start });
        }

        const { weekday, hour } = brusselsParts(r.firstSeen);
        if (weekday !== null) byWeekday[weekday]++;
        if (hour !== null && hour >= 0 && hour < 24) byHour[hour]++;
      }

      perDay.push({
        date,
        total: records.length,
        active,
        resolved,
        carriedOver,
        avgDuration: durations.length ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length) : null,
        maxDuration: durations.length ? Math.max(...durations) : null,
      });
    }

    perDay.sort((a, b) => a.date.localeCompare(b.date));
    longestCandidates.sort((a, b) => b.duration - a.duration);
    const longestFiltered = longestCandidates.filter((l) => {
      const normalizedTitle = (l.title || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase();
      return !normalizedTitle.includes('belgie');
    });

    const body = {
      rangeDays: days,
      days: perDay,
      byWeekday,
      byHour,
      totals: {
        disturbances: perDay.reduce((a, d) => a + d.total, 0),
        daysWithData: perDay.length,
        avgDuration: allDurations.length
          ? Math.round(allDurations.reduce((a, b) => a + b, 0) / allDurations.length)
          : null,
      },
      longest: longestFiltered.slice(0, 5),
    };

    return new Response(JSON.stringify(body), { status: 200, headers });
  } catch (err) {
    console.error('stats failed:', err.message);
    return new Response(JSON.stringify({ error: 'Internal server error' }), { status: 500, headers });
  }
};
