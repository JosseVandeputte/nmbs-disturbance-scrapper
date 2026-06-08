// netlify/functions/disturbances.js
//
// HTTP endpoint for the front-end.
//   GET /.netlify/functions/disturbances                 -> { dates: [...] }
//   GET /.netlify/functions/disturbances?date=YYYY-MM-DD -> [ ...records ]
//
// Modern Netlify function signature so the Blobs environment is injected.

import { getStore } from '@netlify/blobs';

export default async (req) => {
  const store = getStore({ name: 'disturbances', consistency: 'strong' });
  const url = new URL(req.url);
  const date = url.searchParams.get('date');

  const headers = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };

  try {
    if (!date) {
      const { blobs } = await store.list();
      const dates = blobs
        .map((b) => b.key)
        .filter((k) => /^\d{4}-\d{2}-\d{2}$/.test(k))
        .sort()
        .reverse();
      return new Response(JSON.stringify({ dates }), { status: 200, headers });
    }

    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return new Response(JSON.stringify({ error: 'Invalid date format, expected YYYY-MM-DD' }), { status: 400, headers });
    }

    const records = await store.get(date, { type: 'json' });
    return new Response(JSON.stringify(records || []), { status: 200, headers });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers });
  }
};