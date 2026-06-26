/**
 * iRail Disturbances Scraper
 *
 * Polls the iRail disturbances API every 5 minutes and persists disturbances
 * to a daily JSON file (yyyy-mm-dd_log.json) for yearly analysis.
 *
 * Usage:
 *   node disturbances-scraper.js          # run continuously
 *   node disturbances-scraper.js --once   # single poll and exit
 *
 * Uses only Node.js built-ins (fs, crypto, https) — no external dependencies.
 */

import fs from 'node:fs';
import crypto from 'node:crypto';
import https from 'node:https';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const API_URL = 'https://api.irail.be/v1/disturbances/?format=json&lang=nl';
const LOG_DIR = __dirname;
const POLL_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

// Build the log file path for a given date: yyyy-mm-dd_log.json
function logFileFor(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return path.join(LOG_DIR, y + '-' + m + '-' + d + '_log.json');
}

// Fields tracked for change detection (everything except the identity/meta fields)
const TRACKED_FIELDS = [
  'type',
  'title',
  'description',
  'station',
  'startTime',
  'endTime',
  'attachment',
];

function hashTitle(title) {
  return crypto.createHash('sha256').update(String(title)).digest('hex').slice(0, 12);
}

function fetchJSON(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { 'User-Agent': 'irail-disturbances-scraper/1.0' } }, (res) => {
      if (res.statusCode < 200 || res.statusCode >= 300) {
        res.resume();
        return reject(new Error('HTTP ' + res.statusCode));
      }
      let data = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (err) {
          reject(new Error('Failed to parse JSON: ' + err.message));
        }
      });
    });
    req.on('error', reject);
    req.setTimeout(30000, () => {
      req.destroy(new Error('Request timed out'));
    });
  });
}

function loadLog(file) {
  try {
    const raw = fs.readFileSync(file, 'utf8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    console.error('Warning: could not read existing log, starting fresh:', err.message);
    return [];
  }
}

function saveLog(file, records) {
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(records, null, 2));
  fs.renameSync(tmp, file);
}

/**
 * Normalize the API response into a flat array of disturbance objects.
 * The iRail API returns { disturbance: [...] } where each item has an "type"
 * field of "disturbance" or "planned".
 */
function normalizeResponse(json) {
  const items = (json && Array.isArray(json.disturbance)) ? json.disturbance : [];
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

function poll() {
  const nowDate = new Date();
  const now = nowDate.toISOString();
  const file = logFileFor(nowDate);
  const records = loadLog(file);

  return fetchJSON(API_URL).then((json) => {
    const fetched = normalizeResponse(json);
    const fetchedById = new Map();
    for (const f of fetched) fetchedById.set(f.id, f);

    const byId = new Map();
    for (const r of records) byId.set(r.id, r);

    let countNew = 0;
    let countUpdated = 0;
    let countResolved = 0;

    // Process fetched disturbances: new or updated
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
        // Carry over any other tracked fields beyond the canonical set
        for (const field of TRACKED_FIELDS) {
          if (f[field] !== undefined && record[field] === undefined) {
            record[field] = f[field];
          }
        }
        records.push(record);
        byId.set(f.id, record);
        countNew++;
        continue;
      }

      // Existing — detect changes across tracked fields
      let changed = false;
      for (const field of TRACKED_FIELDS) {
        const newValue = f[field] !== undefined ? f[field] : undefined;
        const oldValue = existing[field] !== undefined ? existing[field] : undefined;

        if (newValue === undefined) continue; // don't treat missing-in-response as a change here

        if (oldValue !== newValue) {
          existing.history.push({
            timestamp: now,
            field: field,
            oldValue: oldValue !== undefined ? oldValue : null,
            newValue: newValue,
          });
          existing[field] = newValue;
          changed = true;
        }
      }

      // A disturbance that had been resolved has reappeared
      if (existing.active === false) {
        existing.history.push({
          timestamp: now,
          field: 'active',
          oldValue: false,
          newValue: true,
        });
        existing.active = true;
        changed = true;
      }

      existing.lastSeen = now;
      if (changed) countUpdated++;
    }

    // Process records no longer present in the response: mark resolved
    for (const r of records) {
      if (!fetchedById.has(r.id) && r.active !== false) {
        r.history.push({
          timestamp: now,
          field: 'active',
          oldValue: true,
          newValue: false,
        });
        r.active = false;
        r.lastSeen = now;
        countResolved++;
      }
    }

    saveLog(file, records);

    console.log(
      '[' + now + '] ' + path.basename(file) + ' — ' +
      'new: ' + countNew + ', ' +
      'updated: ' + countUpdated + ', ' +
      'resolved: ' + countResolved + ' ' +
      '(total tracked: ' + records.length + ')'
    );
  }).catch((err) => {
    console.error('[' + now + '] poll failed:', err.message);
  });
}

function main() {
  const once = process.argv.includes('--once');

  if (once) {
    poll().then(() => process.exit(0));
    return;
  }

  console.log('Starting iRail disturbances scraper — polling every ' + (POLL_INTERVAL_MS / 60000) + ' minutes.');
  console.log('Writing daily logs (yyyy-mm-dd_log.json) to: ' + LOG_DIR);

  poll(); // run immediately on startup
  setInterval(poll, POLL_INTERVAL_MS);
}

main();