// netlify/functions/disturbances.js
//
// HTTP endpoint for the front-end.
//   GET /.netlify/functions/disturbances                 -> { dates: [...] }
//   GET /.netlify/functions/disturbances?date=YYYY-MM-DD -> { records: [...], lastPolled: iso|null }
//
// Modern Netlify function signature so the Blobs environment is injected.

import { getStore } from '@netlify/blobs';

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

export default async (req) => {
  const store = getStore({ name: 'disturbances', consistency: 'strong' });
  const url = new URL(req.url);
  const date = url.searchParams.get('date');

  const headers = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...SECURITY_HEADERS };

  try {
    if (!date) {
      const dates = await readDateKeys(store);
      return new Response(JSON.stringify({ dates }), { status: 200, headers });
    }

    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return new Response(JSON.stringify({ error: 'Invalid date format, expected YYYY-MM-DD' }), { status: 400, headers });
    }

    const entry = await store.getWithMetadata(date, { type: 'json' });
    const records = entry && Array.isArray(entry.data) ? entry.data : [];
    const lastPolled = (entry && entry.metadata && entry.metadata.lastPolled) || null;

    // Past days never change again, so they can be cached aggressively.
    const today = new Date().toISOString().slice(0, 10);
    if (date < today) headers['Cache-Control'] = 'public, max-age=86400';

    return new Response(JSON.stringify({ records, lastPolled }), { status: 200, headers });
  } catch (err) {
    console.error('disturbances failed:', err.message);
    return new Response(JSON.stringify({ error: 'Internal server error' }), { status: 500, headers });
  }
};
