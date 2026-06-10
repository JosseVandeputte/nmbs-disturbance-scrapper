# iRail Disturbances — daily log on Netlify

A scheduled function scrapes the [iRail disturbances API](https://api.irail.be)
every 5 minutes and stores each day's disturbances in **Netlify Blobs**
(one entry per day, keyed `yyyy-mm-dd`). A static page lets you pick a date and
review that day's disturbances, including the change history per disturbance.

Only real disturbances (`type: "disturbance"`) are stored — planned engineering
works are skipped.

## Structure

```
netlify.toml                      # build + functions config
package.json                      # @netlify/blobs dependency
public/index.html                 # daily log viewer (month/date sidebar, filter, auto-refresh)
public/trends.html                # trends dashboard + archive search
public/settings.html              # theme preference (system / light / dark)
netlify/functions/scrape.js       # scheduled scraper (every 5 min) -> Blobs
netlify/functions/disturbances.js # GET dates / GET ?date= -> { records, lastPolled }
netlify/functions/stats.js        # GET ?days=90 -> per-day counts, weekday/hour distribution
netlify/functions/search.js       # GET ?q=term -> full-text search across stored days
netlify/functions/rss.js          # RSS 2.0 feed of today's disturbances
```

## Features

- **Daily log** with per-disturbance change history, duration, and "lijn"-chips
  extracted from the text; filterable; linkable via `/?date=YYYY-MM-DD`.
- **Month/date sidebar**: days grouped per collapsible month (current month
  open), with prev/next-day buttons in the header.
- **Auto-refresh**: today's view re-fetches every 2 minutes while the tab is
  visible; the tally shows when the scraper last polled.
- **Trends page**: disturbances per day (last 30 days), busiest weekday and
  hour (Belgian time), longest disturbances, and full-text archive search.
- **Carry-over at midnight**: on the first poll of a new UTC day, records still
  active in yesterday's blob get `carriedOver: true` instead of staying
  "active" forever; they reappear fresh in the new day.
- **RSS feed** at `/.netlify/functions/rss` for passive following.
- **Dark mode**: follows the system by default; override on the settings page
  (system / light / dark, stored in localStorage). Installable (web app manifest).

## Deploy

1. Push this folder to a GitHub repo:
   ```
   git init
   git add .
   git commit -m "iRail disturbances on Netlify"
   git branch -M main
   git remote add origin https://github.com/YOU/REPO.git
   git push -u origin main
   ```
2. In Netlify: **Add new site → Import an existing project** → pick the repo.
   The defaults from `netlify.toml` are picked up automatically.
3. Netlify installs `@netlify/blobs` during build; no env vars or provisioning
   needed — Blobs is zero-config on Netlify compute.

## Notes

- **Scheduled functions only run on the deployed production site**, not in local
  preview. After the first deploy, give it a poll cycle (up to ~5 min) before the
  first day's data appears. You can also trigger `scrape` manually once from the
  Netlify dashboard (Functions tab) to seed data immediately.
- **Dates are UTC.** The day key and the page's date picker both use UTC, so a
  disturbance is filed under the UTC date it was observed.
- **Per-day isolation:** each day is a self-contained record. A disturbance that
  spans midnight gets a fresh `firstSeen` and empty `history` in the new day's
  entry. (Change `dayKey`/storage if you want lifetime-continuous tracking.)

## Local development (optional)

Blobs and scheduled functions need the Netlify CLI to emulate:
```
npm install
npx netlify dev
```
Then visit the local URL it prints. You can invoke the scraper once with
`npx netlify functions:invoke scrape` to seed local data.