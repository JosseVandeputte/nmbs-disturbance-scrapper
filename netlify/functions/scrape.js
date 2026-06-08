// netlify/functions/scrape.js
//
// Scheduled function: runs every 5 minutes, polls the iRail disturbances API,
// and updates the current day's record in a Netlify Blobs store.
//
// Storage model: one blob per day, keyed by "yyyy-mm-dd". Each blob holds an
// array of disturbance records.
//
// Only type === "disturbance" items are stored (planned works are skipped).
//
// Uses the modern Netlify function signature (export default + exported config),
// which is required for the Netlify Blobs environment to be injected.

import crypto from 'node:crypto';
import { getStore } from '@netlify/blobs';

const API_URL = 'https://api.irail.be/v1/disturbances/?format=json&lang=nl';

const TRACKED_FIELDS = ['type', 'title', 'description', 'station', 'startTime', 'endTime', 'attachment'];

function hashTitle(title) {
  return crypto.createHash('sha256').update(String(title)).digest('hex').slice(0, 12);
}

function dayKey(date) {
  return date.toISOString().slice(0, 10);
}

function normalizeResponse(json) {
  const items = json && Array.isArray(json.disturbance) ? json.disturbance : [];
  return items
    .filter((item) => (item.type || 'disturbance') === 'disturbance')
    .map((item) => {
      const out = {};
      for (const f of TRACKED_FIELDS) {
        if (item[f] !== undefined) out[f] = item[f];
      }
      out.type = 'disturbance';
      out.title = item.title !== undefined ? item.title : '';
      out.id = hashTitle(out.title);
      return out;
    });
}

async function fetchDisturbances() {
  const res = await fetch(API_URL, { headers: { 'User-Agent': 'irail-disturbances-scraper/1.0' } });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  return res.json();
}

export default async () => {
  const nowDate = new Date();
  const now = nowDate.toISOString();
  const key = dayKey(nowDate);

  const store = getStore({ name: 'disturbances', consistency: 'strong' });

  let json;
  try {
    json = await fetchDisturbances();
  } catch (err) {
    console.error('[' + now + '] fetch failed:', err.message);
    return new Response('fetch failed', { status: 502 });
  }

  const fetched = normalizeResponse(json);
  const fetchedById = new Map(fetched.map((f) => [f.id, f]));

  let records = [];
  try {
    const existing = await store.get(key, { type: 'json' });
    if (Array.isArray(existing)) records = existing;
  } catch (err) {
    console.error('[' + now + '] could not read blob ' + key + ':', err.message);
  }

  const byId = new Map(records.map((r) => [r.id, r]));

  let countNew = 0;
  let countUpdated = 0;
  let countResolved = 0;

  for (const f of fetched) {
    const existing = byId.get(f.id);

    if (!existing) {
      const record = {
        id: f.id,
        type: f.type,
        title: f.title,
        description: f.description !== undefined ? f.description : '',
        active: true,
        firstSeen: now,
        lastSeen: now,
        history: [],
      };
      for (const field of TRACKED_FIELDS) {
        if (f[field] !== undefined && record[field] === undefined) record[field] = f[field];
      }
      records.push(record);
      byId.set(f.id, record);
      countNew++;
      continue;
    }

    let changed = false;
    for (const field of TRACKED_FIELDS) {
      const newValue = f[field] !== undefined ? f[field] : undefined;
      const oldValue = existing[field] !== undefined ? existing[field] : undefined;
      if (newValue === undefined) continue;
      if (oldValue !== newValue) {
        existing.history.push({ timestamp: now, field, oldValue: oldValue !== undefined ? oldValue : null, newValue });
        existing[field] = newValue;
        changed = true;
      }
    }

    if (existing.active === false) {
      existing.history.push({ timestamp: now, field: 'active', oldValue: false, newValue: true });
      existing.active = true;
      changed = true;
    }

    existing.lastSeen = now;
    if (changed) countUpdated++;
  }

  for (const r of records) {
    if (!fetchedById.has(r.id) && r.active !== false) {
      r.history.push({ timestamp: now, field: 'active', oldValue: true, newValue: false });
      r.active = false;
      r.lastSeen = now;
      countResolved++;
    }
  }

  await store.setJSON(key, records);

  console.log(
    '[' + now + '] ' + key + ' — new: ' + countNew + ', updated: ' + countUpdated +
    ', resolved: ' + countResolved + ' (total tracked: ' + records.length + ')'
  );

  return new Response('ok');
};

// Run every 5 minutes (cron, UTC).
export const config = { schedule: '*/5 * * * *' };