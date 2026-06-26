// netlify/functions/scrape.js
//
// Scheduled function: runs every 5 minutes, polls the iRail disturbances API,
// and updates the current day's record in a Netlify Blobs store.
//
// Storage model: one blob per day, keyed by "yyyy-mm-dd". Each blob holds an
// array of disturbance records; the blob metadata carries `lastPolled` so the
// front-end can distinguish "a calm day" from "the scraper never ran".
//
// On the first poll of a new UTC day, the previous day's blob is closed out:
// records still marked active get `carriedOver: true` (the disturbance ran
// past midnight; it reappears as a fresh record in the new day's blob).
//
// Only type === "disturbance" items are stored (planned works are skipped).
//
// Uses the modern Netlify function signature (export default + exported config),
// which is required for the Netlify Blobs environment to be injected.

import crypto from 'node:crypto';
import { getStore } from '@netlify/blobs';

const API_URL = 'https://api.irail.be/v1/disturbances/?format=json&lang=nl';
const DATE_INDEX_KEY = '__dates__';

const TRACKED_FIELDS = ['type', 'title', 'description', 'station', 'startTime', 'endTime', 'attachment'];

function hashTitle(title) {
  return crypto.createHash('sha256').update(String(title)).digest('hex').slice(0, 12);
}

function stableDisturbanceId(item) {
  const seed = [item.title, item.station, item.startTime]
    .map((v) => String(v == null ? '' : v).trim().toLowerCase())
    .join('|');
  return crypto.createHash('sha256').update(seed).digest('hex').slice(0, 16);
}

function ensureHistoryArray(record) {
  if (!Array.isArray(record.history)) record.history = [];
}

function dayKey(date) {
  return date.toISOString().slice(0, 10);
}

async function updateDateIndex(store, key) {
  let dates = [];
  try {
    const current = await store.get(DATE_INDEX_KEY, { type: 'json' });
    if (Array.isArray(current)) dates = current;
  } catch {
    dates = [];
  }

  if (!dates.includes(key)) {
    dates.push(key);
    dates.sort().reverse();
    await store.setJSON(DATE_INDEX_KEY, dates);
  }
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
      out.legacyId = hashTitle(out.title);
      out.id = stableDisturbanceId(out);
      return out;
    });
}

async function fetchDisturbances() {
  const res = await fetch(API_URL, {
    headers: { 'User-Agent': 'irail-disturbances-scraper/1.0' },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  return res.json();
}

// Mark records that were still active at the end of the previous day as
// carried over. lastSeen is left untouched: it reflects the last real
// observation, so durations stay honest.
async function closeOutPreviousDay(store, key, now) {
  let prev;
  try {
    prev = await store.get(key, { type: 'json' });
  } catch (err) {
    console.error('[' + now + '] could not read previous day ' + key + ':', err.message);
    return;
  }
  if (!Array.isArray(prev)) return;

  let changed = 0;
  for (const r of prev) {
    ensureHistoryArray(r);
    if (r.active !== false) {
      r.history.push({ timestamp: now, field: 'carriedOver', oldValue: null, newValue: true });
      r.active = false;
      r.carriedOver = true;
      changed++;
    }
  }
  if (changed) {
    await store.setJSON(key, prev, { metadata: { finalized: true } });
    console.log('[' + now + '] closed out ' + key + ' — carried over: ' + changed);
  }
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
  const fetchedSeenIds = new Set();

  let records = [];
  let firstPollOfDay = false;
  try {
    const existing = await store.get(key, { type: 'json' });
    if (Array.isArray(existing)) records = existing;
    else firstPollOfDay = existing === null || existing === undefined;
  } catch (err) {
    console.error('[' + now + '] could not read blob ' + key + ':', err.message);
  }

  if (firstPollOfDay) {
    await closeOutPreviousDay(store, dayKey(new Date(nowDate.getTime() - 86400000)), now);
  }

  const byId = new Map(records.map((r) => [r.id, r]));
  for (const r of records) ensureHistoryArray(r);

  let countNew = 0;
  let countUpdated = 0;
  let countResolved = 0;

  for (const f of fetched) {
    const existing = byId.get(f.id) || byId.get(f.legacyId);

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
    if (existing.id !== f.id && !byId.has(f.id)) {
      byId.delete(existing.id);
      existing.history.push({ timestamp: now, field: 'id', oldValue: existing.id, newValue: f.id });
      existing.id = f.id;
      byId.set(existing.id, existing);
      changed = true;
    }

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
    fetchedSeenIds.add(existing.id);
    if (changed) countUpdated++;
  }

  for (const r of records) {
    if (!fetchedSeenIds.has(r.id) && r.active !== false) {
      r.history.push({ timestamp: now, field: 'active', oldValue: true, newValue: false });
      r.active = false;
      r.lastSeen = now;
      countResolved++;
    }
  }

  await store.setJSON(key, records, { metadata: { lastPolled: now } });
  await updateDateIndex(store, key);

  console.log(
    '[' + now + '] ' + key + ' — new: ' + countNew + ', updated: ' + countUpdated +
    ', resolved: ' + countResolved + ' (total tracked: ' + records.length + ')'
  );

  return new Response('ok');
};

// Run every 5 minutes (cron, UTC).
export const config = { schedule: '*/5 * * * *' };
