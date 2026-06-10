// netlify/functions/search.js
//
// Full-text search across stored days.
//   GET /.netlify/functions/search?q=brussel&days=92 -> { query, results: [...] }
//
// Matches case-insensitively against title + description. Results are ordered
// newest first and capped, so the response stays small even for broad terms.

import { getStore } from '@netlify/blobs';

const MAX_DAYS = 92;
const MAX_RESULTS = 100;

export default async (req) => {
  const url = new URL(req.url);
  const q = (url.searchParams.get('q') || '').trim().toLowerCase();
  let days = parseInt(url.searchParams.get('days'), 10);
  if (!Number.isFinite(days) || days < 1) days = MAX_DAYS;
  days = Math.min(days, MAX_DAYS);

  const headers = { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=300' };

  if (q.length < 2) {
    return new Response(JSON.stringify({ error: 'Query must be at least 2 characters' }), { status: 400, headers });
  }

  const store = getStore({ name: 'disturbances', consistency: 'strong' });

  try {
    const { blobs } = await store.list();
    const keys = blobs
      .map((b) => b.key)
      .filter((k) => /^\d{4}-\d{2}-\d{2}$/.test(k))
      .sort()
      .reverse()
      .slice(0, days);

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

    const results = [];
    for (const [date, records] of dayData) {
      const hits = records
        .filter((r) => ((r.title || '') + ' ' + (r.description || '')).toLowerCase().includes(q))
        .sort((a, b) => String(b.firstSeen).localeCompare(String(a.firstSeen)))
        .map((r) => ({
          date,
          id: r.id,
          title: r.title,
          description: r.description,
          firstSeen: r.firstSeen,
          lastSeen: r.lastSeen,
          active: r.active,
          carriedOver: r.carriedOver === true,
        }));
      results.push(...hits);
      if (results.length >= MAX_RESULTS) break;
    }

    return new Response(
      JSON.stringify({ query: q, searchedDays: keys.length, results: results.slice(0, MAX_RESULTS) }),
      { status: 200, headers }
    );
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers });
  }
};
