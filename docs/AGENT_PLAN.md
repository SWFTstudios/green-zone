# Green Zone: plan to get the production web app fully working

Hand this file to a coding agent (for example Cursor) that has **GitHub MCP**, **Cloudflare MCP** and a terminal. Work through the phases in order. Each task says how to check it worked. Steps marked **HUMAN** need the owner, so stop and ask for them.

Written 2026-10-27. Re-check the "Current state" facts before acting, because they may have changed.

---

## 1. What the app is

- **Green Zone** is a driving-for-dollars web app. Users paint streets green, yellow or red while driving, save trips, and use an **Explore** tab that scores Census tracts from Zillow, Census and OpenStreetMap data. Searches can be saved. Guests can use everything without signing in.
- **Repo:** `SWFTstudios/green-zone`. `README.md` explains the architecture, data sources and API. Read it first.
- **Stack:** Cloudflare Workers (TypeScript, `src/`), static front end in `public/` (no build step), D1 database (`migrations/`), Cloudflare Email Service for sign-in codes, and a daily cron for Zillow imports.
- **Local development:** `npm install`, `cp .dev.vars.example .dev.vars`, `npm run db:migrate:local`, `npm run dev`. For offline Explore data, run `node test/mock-data-server.mjs` and uncomment the `*_URL` lines in `.dev.vars`. Tests run with `npm test` and type checking with `npm run typecheck`.

## 2. Cloudflare resources

| Thing | Value |
| --- | --- |
| Account ID | `e246ec2918a6cd045fd4bfd00f024f0c` |
| Production Worker | `green-zone`, at https://green-zone.elombe.workers.dev |
| Production D1 | `green-zone-db`, id `5c7ca051-beca-4865-a1a9-f239748a0b8d` |
| Preview D1 (unused so far) | `green-zone-preview-db`, id `c2946a07-1a07-4ba6-96b7-ca875f582efd` |
| Email sending domain | `greenzone.swftstudios.com` (onboarded under Compute → Email Service → Email Sending) |
| Sender address in code | `login@greenzone.swftstudios.com` (`EMAIL_FROM` in `wrangler.jsonc`) |
| Deploys | **Workers Builds** (Cloudflare's Git integration) builds `main` and deploys `green-zone`. It also posts a "Workers Builds: green-zone" check on PRs. |

The account has about 30 other Workers and D1 databases for other projects. **Only touch the resources in this table.**

## 3. Current state (verified 2026-10-27, about 20:15 UTC)

- `main` has Explore (PR #3, merged). **Guest mode and the real sender address are in PR #4 (open, draft), not on `main` yet.** So the live site still sends from `login@example.com`, and sign-in fails with "We couldn't send the email."
- PR #4's **Workers Builds preview build failed** instantly (build `4d911eb4-5453-4f11-8dfe-bb0eac343b5c`). The cause is unknown; the log is only in the Cloudflare dashboard.
- The GitHub Actions workflow `.github/workflows/deploy.yml` fails on every push because the `CLOUDFLARE_API_TOKEN` secret was never added. It duplicates what Workers Builds already does.
- Production and preview D1 have migrations `0001_init.sql` through `0005_reviews.sql` applied, and recorded in `d1_migrations`. There are 0 users, 0 trips and 3 failed sign-in code requests.
- **No Explore data has loaded yet:** `zillow_imports`, `zip_market` and `area_cache` are all empty. The daily cron (`23 9 * * *` UTC) hasn't run since Explore deployed.
- **Unverified against the real services**, because the app was built in a sandbox that couldn't reach them:
  - TIGERweb layer and field names
  - Census ACS year availability
  - the size of Overpass responses
  - the Zillow CSV download paths
  - an actual email send from `greenzone.swftstudios.com`

## 4. Ground rules

- Never commit secrets. Set them with `wrangler secret put` or the Cloudflare API, and give values to the owner only through a channel they choose.
- Don't change DNS records on the apex `swftstudios.com`. Only the `greenzone.swftstudios.com` records belong to this app.
- Production D1 holds real user data once people sign up. For any destructive SQL (`DELETE`, `DROP`, `UPDATE` without a narrow `WHERE`), ask first. D1 Time Travel can restore the database to a point in time if needed.
- Keep changes small, one PR per concern, and run `npm test` and `npm run typecheck` before pushing.
- For each schema change: add a new `migrations/000N_*.sql`, apply it with `wrangler d1 migrations apply green-zone-db --remote` (or the D1 MCP plus a row in `d1_migrations`), and do this **before** the code that needs it is deployed. Workers Builds does not run migrations.

## 5. Tools

- **GitHub MCP:** read and merge PRs, check runs, edit files.
- **Cloudflare MCP:** use the Cloudflare **API** MCP server (`https://mcp.cloudflare.com/mcp`). The older "Workers Bindings" server is deprecated and can only list Workers and query D1. It can't read build logs, secrets, Email Service settings or DNS. Anything the MCP can't do can be done with `wrangler` and a Cloudflare API token, or by the owner in the dashboard.
- **Terminal:** `npx wrangler …` needs `wrangler login` or a `CLOUDFLARE_API_TOKEN`. The token needs Workers Scripts Edit, D1 Edit, Workers Builds Read, Email Sending Read and Zone DNS Read.

---

## Phase 1: Get PR #4 onto `main`

**1.1 Find out why the PR #4 preview build failed.**
- Read the build log for build `4d911eb4-5453-4f11-8dfe-bb0eac343b5c`, using the Cloudflare API MCP (Workers Builds) or the dashboard at *Workers & Pages → green-zone → Deployments/Builds*.
- Likely suspects to rule out:
  - non-production branch builds run `wrangler versions upload`, which may reject parts of the config, such as the `env.preview` block or `triggers`
  - a build-settings issue, such as the root directory, build command or the Node version
  - account build limits
- Fix it in a commit on PR #4's branch (`claude/neighborhood-safety-zones-2eie9l`).
- *Check:* the "Workers Builds: green-zone" check on PR #4 is green.

**1.2 Merge PR #4.** **HUMAN:** get the owner's approval. Then mark the PR ready, and merge.
- *Check:*
  - The production build on `main` succeeds.
  - `green-zone`'s last-modified time updates.
  - Opening https://green-zone.elombe.workers.dev in a fresh browser lands in the app with a yellow **GUEST** badge, with no sign-in screen.

## Phase 2: Use one deploy pipeline

**2.1 Remove the redundant GitHub Actions deploy.** Workers Builds is the live pipeline. Delete `.github/workflows/deploy.yml` and update the "Deploy to Cloudflare" section of `README.md` to describe Workers Builds. Only keep the workflow if the owner wants GitHub Actions instead; then they'd add a `CLOUDFLARE_API_TOKEN` secret and disconnect Workers Builds, so the two don't race.
- *Check:* pushes no longer produce a failing "deploy" check.

**2.2 Decide what to do with the `preview` environment.** Workers Builds previews (`wrangler versions upload`) are versions of the **production** Worker. They use the production D1 and email binding, not the `env.preview` block. Either:
- remove `env.preview` and `green-zone-preview-db`, which is simplest; or
- deploy it once with `npx wrangler d1 migrations apply green-zone-preview-db --remote --env preview && npx wrangler deploy --env preview`, and document that it's manual.

Note for the owner: because PR previews share the production database, a preview build of a PR can read and write real data.

## Phase 3: Email sign-in

**3.1 Check the sending domain.**
- Under *Compute → Email Service → Email Sending → greenzone.swftstudios.com → Settings*, all records should show as configured (Locked or Unlocked is fine):
  - MX and SPF on `cf-bounce.greenzone.swftstudios.com`
  - DKIM on `cf-bounce._domainkey.greenzone.swftstudios.com`
  - DMARC on `_dmarc.greenzone.swftstudios.com`
- Confirm with DNS lookups, for example `dig TXT cf-bounce._domainkey.greenzone.swftstudios.com +short`.

**3.2 Confirm the plan.** Sending to arbitrary recipients requires **Workers Paid**. Check the account's Workers plan; if it's Free, **HUMAN:** upgrade. Explore also needs Paid, because the free plan's 10 ms CPU limit is too small.

**3.3 End-to-end test.** **HUMAN:** on the live site, choose **Save my work with email** from the account menu, enter a real inbox you control, and report whether the 6-digit code arrives (check spam too).
- If it fails:
  - Check the Worker logs (`npx wrangler tail green-zone`, or Workers Observability) for `Failed to send login code` and the error behind it.
  - Check Email Sending's activity log in the dashboard.
- Typical causes:
  - the sender domain isn't verified yet (wait up to 24 hours)
  - a mismatch between `EMAIL_FROM` and the onboarded domain
  - the plan or daily sending quota
- *Check:* signing in works, and the guest's trips carry into the account. In D1, `SELECT email, is_guest FROM users` shows the real email with `is_guest = 0`.

## Phase 4: Secrets

**4.1 `ADMIN_TOKEN`.** Generate a random value (32+ bytes), set it with `npx wrangler secret put ADMIN_TOKEN` (production, no `--env`), and hand it to the owner privately. It unlocks `POST /api/admin/zillow-import`.

**4.2 `CENSUS_API_KEY`.** **HUMAN:** request a free key at https://api.census.gov/data/key_signup.html. Then set it with `npx wrangler secret put CENSUS_API_KEY`. The Census API now rejects keyless requests, so Explore has no Census numbers without it.

**4.3 `REVIEW_TO`.** **HUMAN:** the inbox that receives reviews. Set it with `npx wrangler secret put REVIEW_TO`. Never put the address in `wrangler.jsonc`, the docs or a PR: the repo is public.

**4.4 `RENTCAST_API_KEY` (optional).** Turns on the "Market now" listings snapshot in area details. RentCast is metered; the app caps itself at 45 calls a month (`RENTCAST_MONTHLY_LIMIT`).
- *Check:* `npx wrangler secret list` shows `ADMIN_TOKEN`, `CENSUS_API_KEY` and `REVIEW_TO`.

## Phase 5: Load and validate real Explore data

**5.1 Import Zillow data now** (instead of waiting about 3 days for the cron). Repeat until `remaining` is empty:
```bash
curl -s -X POST "https://green-zone.elombe.workers.dev/api/admin/zillow-import?dataset=next" \
  -H "Authorization: Bearer $ADMIN_TOKEN"
```
- Each call imports one of 9 datasets. A healthy call returns `ok: true`, roughly 26,000–30,000 `rows`, and a recent `month`.
- If a dataset returns `HTTP 404`, Zillow has moved its CSVs. Find the current ZIP-level links on https://www.zillow.com/research/data/ (ZHVI all homes, single-family, condo/co-op, 1–5 bedrooms; ZORI all homes plus multifamily). Update the `path` values in `src/areas/zillowCsv.ts`, open a PR, deploy, and re-run with `dataset=<id>`.
- If a call fails with a CPU or time limit, look at the logs. The import streams the CSV and flushes every 3,000 rows (`FLUSH_ROWS` in `src/areas/zillow.ts`), and may need tuning.
- *Check:* `SELECT COUNT(*) FROM zip_market` is in the tens of thousands, and `SELECT dataset, month, rows, error FROM zillow_imports` shows 9 rows with no errors.

**5.2 Exercise `/api/areas` on a real city.**
- Get a session cookie with `curl -c jar -X POST https://green-zone.elombe.workers.dev/api/auth/guest`. Send no `Origin` header, or the site's own origin.
- Then repeat this until `pending` is 0:
  ```bash
  curl -s -b jar -X POST https://green-zone.elombe.workers.dev/api/areas \
    -H 'content-type: application/json' -d '{"bbox":"-75.20,39.93,-75.12,39.98"}'
  ```
  The example box is Philadelphia; try one more city too.
- Look at `notices` in each response. Every failing source is named there.
- For areas that finished, check that `metrics` has non-null values from each source:
  - Census: `medianIncome`, `vacancyRate`
  - OpenStreetMap: `litPerKm2`, `parks`
  - ZIP and Zillow: `zip`, `zhvi`
  - FEMA: `floodShare` (most tracts are 0; tracts along rivers or the coast should not all be 0)
  - FRED: `mortgagePayment`, `rentCoverage`

  `missing` should be `[]`.
- Each source has assumptions to fix in code if they turn out wrong:

| Source | Assumption | Where |
| --- | --- | --- |
| TIGERweb | Layers are found by name: `/^Census Tracts$/` in `Tracts_Blocks`, `/ZIP Code Tabulation/` in `PUMA_TAD_TAZ_UGA_ZCTA`. Tract fields are `GEOID`, `NAME`, `BASENAME`, `AREALAND`, `INTPTLAT`, `INTPTLON`. ZIP field is one of `ZCTA5`, `ZCTA5CE20`, `GEOID`, `BASENAME`. | `src/areas/tiger.ts`. Inspect `…/MapServer?f=json` and `…/MapServer/<id>?f=json`. |
| Census ACS | 5-year table IDs in `ACS_VARIABLES`. The year falls back from the current year minus 2 by up to two more years (override with the `ACS_YEAR` var). | `src/areas/acs.ts`, `src/areas/index.ts` |
| Overpass | One query per batch of up to 30 tracts, a box of at most 0.12°, 60 s timeout, `out center qt`. Public `overpass-api.de` may rate-limit (429). | `src/areas/osm.ts`; batch size in `src/areas/index.ts` (`METRICS_PER_REQUEST`, `OSM_SPAN_CAP_DEG`). With heavy use, set the `OVERPASS_URL` var to another instance. |
| FEMA NFHL | `…/NFHL/MapServer/export` draws layer 28 ("Flood Hazard Zones") filtered with `layerDefs` to `SFHA_TF = 'T'`, as a transparent PNG at about 12 m a pixel. If every tract is 0 near a river, check that the layer id and field still match `…/MapServer?f=json`. | `src/areas/flood.ts` |
| FRED | `fredgraph.csv?id=MORTGAGE30US` returns `observation_date,MORTGAGE30US` rows. | `src/areas/mortgage.ts` |
| CPU | Building metrics does point-in-polygon work in the Worker. | If logs show exceeded CPU, lower `METRICS_PER_REQUEST`, or raise `limits.cpu_ms` in `wrangler.jsonc` (Paid plan). |

- *Check:* in the browser, **Explore** in a real city shows colored tracts with "N of N areas on screen ready", and an area's detail shows Census, Zillow and OpenStreetMap numbers.

## Phase 6: Production smoke test

Run the following on the live site, on a phone if possible. Record anything broken as a GitHub issue with steps to reproduce.

1. **Landing page:** `/` shows the landing page. The scoring sliders recolor the sample grid. **Leave a review** sends a review, and it arrives in the `REVIEW_TO` inbox (`SELECT rating, emailed_at FROM reviews` shows `emailed_at` set). **Open the app** goes to `/app`.
1. **Fresh browser:** `/app` starts you as a **Guest**, with a toast explaining guest mode, and the first-run tour opens. Step through it; the account menu's **Take the tour** replays it, and **How to use Green Zone** opens the guide with the map key.
2. **Painting:** tap **Green**, then walk or drive, or use **✎ Draw** and tap the map. Switch to **Red**, use **Add note**, then **Finish trip**. The "Email me a summary" option is hidden for guests. Save, and the trip page opens.
3. **Lists:** **Trips** and **My map** show the drive.
4. **Explore:**
   - Search a city, and tracts color in.
   - Change the preset, and the colors change.
   - Add "Typical home value" with a range and **Must have**, and failing areas get a dashed outline.
   - Tap an area to see its details.
   - Save a search, reload, reopen it from **Saved searches**, then rename and delete it.
5. **Map layers:**
   - In Explore, open **Layers** and switch each "Color neighborhoods by" option. The legend changes, and Active adults, Walk & bike and Night brightness show a spread of colors rather than one flat color. If one is flat or gray, look under **About this data** for a CDC or night-lights notice.
   - Switch to **Flood risk** and **Rent vs. mortgage**. Turn on **Flood zones** imagery and zoom in near a river: blue floodplain appears.
   - Turn on **Night lights imagery**, switch to **Satellite**, and tap **3D**.
   - Turn on **Also show on Drive**. On Drive, the area colors show faintly, and tapping one opens a card.
   - Type in the place box, and suggestions appear.
6. **Account menu:** **Save my work with email** sends a code, the account keeps the guest's trip, and the badge changes to **FREE**.
7. **Sign out:** the sign-in screen offers **Continue as guest**, and it works.
8. **Pro (optional):** `UPDATE users SET plan='pro' WHERE email='<owner email>'`. The **Key** page then allows custom zones, such as Purple.

## Phase 7: Hardening (after it works)

- **Map tiles:** base maps come from OpenFreeMap (free, no key) with an OpenStreetMap raster fallback, and place search uses the public Photon server. Before heavy traffic, consider a tile and geocoding provider account, configured in `BASE_STYLES` (`public/gzmap.js`) and `fetchSuggestions` (`public/explore.js`).
- **Data source checks:** confirm the CDC PLACES dataset id (`cwsq-ngmh`, tract-level) is still current at data.cdc.gov, and that the NASA GIBS Black Marble tile URL in `src/areas/index.ts` returns images. Both can be overridden with `CDC_PLACES_DATASET` and `NIGHT_LIGHTS_TILES`.
- **Place search** calls Nominatim from the browser. Keep it low-volume, or move it to a provider with a key.
- **Rate limiting:** add Cloudflare WAF rate-limiting rules for `/api/auth/*`, `/api/areas` and `/api/admin/*` on the workers.dev hostname or a custom domain.
- **Custom domain (optional):** for example `greenzone.swftstudios.com` as the app's address, under *Worker → Settings → Domains & Routes*. Sign-in links in emails use whichever host the request came in on.
- **Cleanup:** old `login_codes` rows are never deleted, so add an expiry purge to the daily cron in `src/index.ts`.
- **PR #1** (`cursor/green-zone-mvp-8a29`, a native iOS MVP) is separate work. Leave it unless the owner says otherwise.

---

## Definition of done

- `main` includes guest mode and the real sender, and its Workers Builds build is green. There's exactly one deploy pipeline.
- A fresh visitor can use the app as a guest, and email sign-in delivers a code to a real inbox.
- `ADMIN_TOKEN` and `CENSUS_API_KEY` are set. All 9 Zillow datasets are imported without errors.
- Explore works in at least two real cities, with Census, Zillow and OpenStreetMap metrics present (`missing: []`).
- The Phase 6 smoke test passes, or each failure is filed as an issue.

## What to report back

When you finish, or get blocked, reply with:
1. Each phase and task: done, skipped (and why), or blocked (and what's needed from the owner).
2. PRs opened or merged, with links.
3. Any code changes made to match the real APIs (Zillow paths, TIGERweb fields and so on).
4. Anything still broken, with the error text.
