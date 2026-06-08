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
public/index.html                 # the date-picker viewer (static site)
netlify/functions/scrape.js       # scheduled scraper (every 5 min) -> Blobs
netlify/functions/disturbances.js # HTTP API the page calls to read data
```

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