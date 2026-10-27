# Green Zone

Driving for dollars made easier. Drive a neighborhood, tap **Green**, **Yellow** or **Red**, and the street you're on gets painted that color on the map as you go. When the trip is done, name it, write notes, and fill in the key that explains what each color meant. Every trip is saved to your account, and you can get a summary by email.

| Color | Default meaning (editable) |
| --- | --- |
| 🟩 Green zone | Good neighborhood. Feels safe; I'd walk here or let my kids play outside. Homes and yards are well kept. |
| 🟨 Yellow zone | Mixed or changing. Some vacant or run-down houses, so use caution. Could be an opportunity. |
| 🟥 Red zone | Sketchy. I wouldn't feel safe walking here or letting my kids play outside. Lots of boarded-up or abandoned properties. |

## Features

**Free (real estate)**
- **No sign-up needed.** First-time visitors go straight into the app as a guest, and guests can drive, save trips, use Explore and save searches. A guest's work belongs to that browser until they choose **Save my work with email** from the account menu. If that email already has an account, everything the guest made moves into it. Empty guest accounts are removed after 30 days, and each network can start at most 30 guest accounts a day.
- Or sign in with an emailed 6-digit code. There are no passwords.
- **Drive** screen with big color buttons. Tap a color to start painting. Tap another color when the neighborhood changes, tap the same color or **Pause** to stop, and **Undo** to remove the last stretch.
- GPS painting that skips weak fixes and GPS jumps, keeps the screen awake, and follows your location.
- **Draw mode (✎)** for painting by tapping along streets, so you can mark areas from home or on a laptop.
- **Add note** drops a pin where you are, for example "vacant house, overgrown yard, 412 Maple".
- The trip in progress is saved on the phone, so it survives a refresh, a dead tab or lost signal. Uploads are safe to retry and never create duplicates.
- **Finish trip** lets you name the drive, add a note for each color you used ("what you saw on this trip"), write general notes, and optionally email yourself a summary.
- **Trips** lists every drive with a color breakdown. Open one to see it on the map with its key, edit it, or delete it.
- **My map** shows everything you've ever painted, with per-color mileage and filters.
- **Key** lets you rewrite what Green, Yellow and Red mean to you.

**Explore: area scores for investors**
- The **Explore** tab colors every neighborhood (Census tract) on screen green, yellow or red based on **your** criteria, and recolors instantly as you change them.
- Start from a preset (Balanced investor, Cash-flow rentals, Appreciation, Fix and flip, Active and well lit, Single-family neighborhoods), then add, remove or reweight criteria. Each criterion can be "higher is better", "lower is better" or "within a range", and can be marked **Must have**. Areas that miss a must-have are outlined or hidden.
- Tap an area for its score breakdown and every number behind it.
- **Saved searches**: name a search to keep its criteria, map view and a snapshot of the results, then reopen, update, rename or delete it later. Free accounts get 5, Pro gets 100.
- Your own drives count: streets you painted feed a "Your drive ratings" criterion, from +100 (all green) to −100 (all red).
- **Also show on Drive** (in the Layers menu) shows the same area colors faintly under your painting, and tapping an area there opens a card with a link to it in Explore.

**The map**
- Vector map built on [MapLibre GL](https://maplibre.org/). It supports pinch, rotate and tilt, smooth zoom, and 3D buildings (the **3D** button).
- **Layers** button: choose Map, Light or Satellite, and color neighborhoods by your criteria or by a single data layer:
  - Active adults (CDC PLACES)
  - Walk and bike commuters (Census ACS)
  - Night brightness (NASA Black Marble)
  - Transit commuters (Census ACS)
- The Layers menu also turns on the NASA night-lights imagery and sets the overlay's opacity.
- A legend shows the current layer and its range. On desktop, hovering an area shows its name and score.
- The place search suggests addresses, neighborhoods and cities as you type, using [Photon](https://photon.komoot.io/).

**Pro (any use case)**
- Add your own zones with any name and color, for example *Purple: a community we want to reach out to*. Up to 24 zones.
- Rename and recolor Green, Yellow and Red.
- If someone drops back to Free, their custom zones are locked for new drives, but old trips keep their colors.

## Area data sources

| What | Source | Level | Notes |
| --- | --- | --- | --- |
| Home values by type (all, single-family, condo, 1–5 bedrooms) and 12-month change | [Zillow Research](https://www.zillow.com/research/data/) ZHVI | ZIP code | Free with attribution. Imported monthly by a cron job. |
| Asking rents and 12-month change | Zillow Research ZORI | ZIP code | Used with ZHVI for gross rent yield. |
| Home value, rent, income, vacancy, owner/renter share, year built, unemployment, units-in-structure mix, population | [Census ACS 5-year](https://www.census.gov/data/developers/data-sets/acs-5year.html) | Tract | Housing and economic tables only. Nothing about race, ethnicity, religion, sex, family status or disability is fetched or scored. |
| How people get to work: walk or bike, transit, work from home | Census ACS 5-year, table B08301 | Tract | A free stand-in for "where people are out on foot". Shares count only people who travel to work. |
| Active adults (share of adults who got physical activity outside work in the past month) | [CDC PLACES](https://www.cdc.gov/places/) via data.cdc.gov | Tract | Model-based estimate, 100% minus the "no leisure-time physical activity" measure. Refreshed yearly; cached 90 days. |
| Night brightness | [NASA Black Marble](https://blackmarble.gsfc.nasa.gov/) (VIIRS) tiles from [NASA GIBS](https://www.earthdata.nasa.gov/engage/open-data-services-software/earthdata-developer-portal/gibs-api) | Tract | Average brightness of the 2016 composite inside each tract, 0–100. Also shown as map imagery. |
| Tract and ZIP boundaries | [Census TIGERweb](https://tigerweb.geo.census.gov/) | Tract, ZCTA | Layers are looked up by name. |
| Outdoor activity (parks, trails, fitness spots), street lighting (lit streets, street lamps), transit, grocery, schools, restaurants, healthcare, land use | [OpenStreetMap](https://www.openstreetmap.org/) via Overpass | Tract | Crowd-mapped, so coverage varies by city. |
| Your drive ratings | Your own trips | Tract | Computed in the browser and visible only to you. |

What isn't included, and why:
- **Strava.** Strava's API terms (since November 2024) only allow showing an athlete's data to that athlete, and rule out aggregate heatmaps and analytics. "Where people work out outside" comes from CDC PLACES activity estimates, Census walk and bike commuting, and OpenStreetMap parks, trails and fitness spots instead.
- **Legal zoning.** There's no free nationwide zoning dataset. "Main land use" is what's mapped in OpenStreetMap, labeled as not legal zoning. A parcel and zoning provider such as Regrid could be added as another source.
- **Crime.** There's no reliable, free, nationwide source at neighborhood level.
- **Zillow listings.** Zillow doesn't allow scraping listings, so only the free Research datasets are used.

How it runs: `POST /api/areas` takes the map view and returns tracts with metrics. Boundaries load in 0.1° tiles and metrics in batches of up to 30 nearby tracts, so the client polls until `pending` reaches 0. Results are cached in D1: tract metrics and Census responses for 30 days, and a retry after 15 minutes for any source that failed. Zillow values are joined from `zip_market` on every read, so a new monthly import shows up immediately.

## Tech

- **Cloudflare Workers** runs the API (`src/`) and serves the front end (`public/`) as static assets.
- **Cloudflare D1** stores users, sessions, sign-in codes, zones, trips, painted segments, note pins, saved searches and cached area data (`migrations/`).
- A **cron trigger** refreshes Zillow data daily (`src/areas/zillow.ts`).
- **Cloudflare Email Service** (`send_email` binding) sends sign-in codes, the welcome email and trip summaries.
- The front end is plain JavaScript with [MapLibre GL JS](https://maplibre.org/) (copied into `public/vendor/` by `npm run vendor`). `public/gzmap.js` wraps it for the rest of the app. It has no build step and can be installed to a phone's home screen.

Security notes: sign-in codes and session tokens are stored only as SHA-256 hashes. Codes expire after 10 minutes, allow 5 attempts, and are limited to 5 per email per hour. Sessions use an `HttpOnly`, `SameSite=Lax` cookie, and the API also rejects cross-site POST, PATCH and DELETE requests. Every query is scoped to the signed-in user.

## Run locally

```bash
npm install
cp .dev.vars.example .dev.vars     # DEV_MODE=1 shows the sign-in code on screen
npm run db:migrate:local
npm run dev                        # http://localhost:8787
```

To work on Explore offline, run `node test/mock-data-server.mjs` and uncomment the `*_URL` and `NIGHT_LIGHTS_TILES` lines in `.dev.vars`. That serves a synthetic grid of Philadelphia tracts with made-up Census, CDC, night-lights, OpenStreetMap and Zillow numbers. Unit tests run with `npm test`.

Locally, emails aren't sent. Wrangler prints them to the console and saves them under `.wrangler/tmp/email/`.

Phones only allow GPS on `https://` pages or `localhost`. To try it on a phone during development, use `npx wrangler dev --remote` or a tunnel such as `cloudflared tunnel --url http://localhost:8787`.

## Deploy to Cloudflare

Production is the `green-zone` Worker. Both D1 databases already exist, and their IDs are in `wrangler.jsonc`.

| Target | How | Database | Sign-in |
| --- | --- | --- | --- |
| Production (`green-zone`) | Push to `main` via **Workers Builds** | `green-zone-db` | Code sent by email |
| Branch Previews | Push to any other branch via Workers Builds (`npx wrangler preview`) | `green-zone-preview-db` (see `previews` in `wrangler.jsonc`) | `DEV_MODE=1` shows the code on screen |
| Persistent demo (`green-zone-preview`) | Manual `npx wrangler deploy --env preview` | `green-zone-preview-db` | Code shown on screen |

Workers Builds is the live pipeline (Cloudflare's Git integration). It does **not** run D1 migrations — apply those before the code that needs them is deployed:

```bash
npx wrangler d1 migrations apply green-zone-db --remote
```

### Manual deploy

```bash
npx wrangler login
npx wrangler d1 migrations apply green-zone-preview-db --remote --env preview
npx wrangler deploy --env preview        # persistent preview Worker
npm run db:migrate:remote && npm run deploy   # production
```

### Before production takes real users

Email sign-in sends from `login@greenzone.swftstudios.com`. Guest mode works without any of this.

1. **Onboard the sending subdomain.** In the Cloudflare dashboard, go to **Compute → Email Service → Email Sending → Onboard Domain** and choose the subdomain `greenzone.swftstudios.com`. You may need to type it, since it doesn't need a website. Cloudflare adds the bounce MX, SPF, DKIM and DMARC records on that subdomain only, so mail you send and receive as @swftstudios.com isn't affected. Onboarding the apex domain instead would add a strict `p=reject` DMARC record to swftstudios.com if it doesn't already have one.
   - swftstudios.com has to use Cloudflare DNS in the same Cloudflare account as the Worker.
   - Sending to any address requires the Workers Paid plan.
   - New accounts start with a small daily sending quota that grows with good deliverability.
2. **Check the sender** in `wrangler.jsonc`, under the top-level `vars`:
   - `EMAIL_FROM` is `login@greenzone.swftstudios.com`. If you change the subdomain, change it here too.
   - `EMAIL_FROM_NAME` is the display name, for example `Green Zone`.
   - `PRO_EMAILS` is a comma-separated list of emails that always get Pro (optional).
   - Leave `DEV_MODE` empty. If it were set, sign-in codes would be shown to anyone.

### Area data setup

- **Zillow** loads by itself. The daily cron imports up to three stale datasets per run, so all nine load within three days of the first deploy. To load them right away, set an admin token and call the import endpoint once per dataset:
  ```bash
  npx wrangler secret put ADMIN_TOKEN
  curl -X POST "https://<your-worker>/api/admin/zillow-import?dataset=next" -H "Authorization: Bearer <token>"
  ```
  Each call imports the next stale dataset and lists what's left. Import status, including any error such as a changed Zillow file path, appears under **Explore → About this data**. If Zillow moves its CSVs, update the paths in `src/areas/zillowCsv.ts`, or point `ZILLOW_BASE_URL` at a mirror.
- **Census key (recommended):** without a key the Census API allows about 500 calls a day. Get a free key at https://api.census.gov/data/key_signup.html and run `npx wrangler secret put CENSUS_API_KEY`.
- **Overpass:** the public `overpass-api.de` instance has a fair-use limit. With heavy traffic, set `OVERPASS_URL` to your own or a commercial instance.
- **CDC PLACES** works without a key. For higher limits, create a free Socrata app token at data.cdc.gov and run `npx wrangler secret put SOCRATA_APP_TOKEN`. When CDC publishes a new PLACES release, set `CDC_PLACES_DATASET` to its dataset id.
- **Night lights** use the NASA GIBS tile URL in `src/areas/index.ts`. Set `NIGHT_LIGHTS_TILES` (with `{z}`, `{y}`, `{x}`) and `NIGHT_LIGHTS_ZOOM` to use another source.
- Area scoring needs the **Workers Paid** plan. The free plan's 10 ms CPU limit is too small for building tract metrics and importing Zillow CSVs.

### Giving someone Pro

Online checkout isn't connected yet. To give someone Pro, either add their email to `PRO_EMAILS` and redeploy, or run:

```bash
npx wrangler d1 execute green-zone-db --remote \
  --command "UPDATE users SET plan='pro' WHERE email='someone@example.com'"
# add --env preview and use green-zone-preview-db for the preview
```

A payment provider such as Stripe can set the same `plan` column from a webhook later.

### Map tiles

The base maps are set in `BASE_STYLES` in `public/gzmap.js`:
- **Map** and **Light** use free [OpenFreeMap](https://openfreemap.org/) vector styles (Liberty and Positron). They need no key and have no request limits.
- **Satellite** uses [USGS](https://www.usgs.gov/) public-domain imagery.
- If a style fails to load within 10 seconds, the map falls back to OpenStreetMap raster tiles. Those are fine for light use under the [OSM tile usage policy](https://operations.osmfoundation.org/policies/tiles/).
- To use MapTiler, Stadia or another provider, change the style URLs.

Place suggestions come from the public Photon server, which is meant for moderate use. For heavy traffic, run your own Photon or switch `fetchSuggestions` in `public/explore.js` to a paid geocoder.

## API

All routes are under `/api` and use JSON. Everything except auth needs the session cookie.

| Method | Path | Purpose |
| --- | --- | --- |
| POST | `/api/auth/request` | `{email}` → email a sign-in code |
| POST | `/api/auth/verify` | `{email, code}` → start a session; creates the account on first sign-in. From a guest session it turns the guest into that account, or merges the guest's data into it. |
| POST | `/api/auth/guest` | Start a guest account and session; no email needed |
| POST | `/api/auth/logout` | End the session |
| GET | `/api/me` | Current user and plan |
| GET / POST | `/api/zones` | List zones / add a zone (Pro) |
| PATCH / DELETE | `/api/zones/:id` | Edit a zone's meaning (all plans) or its name and color (Pro) / remove a custom zone (Pro) |
| GET / POST | `/api/trips` | List trips / save a finished trip (segments, pins, key notes, `emailSummary`) |
| GET / PATCH / DELETE | `/api/trips/:id` | Trip with segments and pins / edit name, notes and key notes / delete |
| GET | `/api/map` | Every segment and pin for the "My map" view |
| POST | `/api/areas` | `{bbox: "w,s,e,n", have?: [geoid]}` → tracts in view with metrics; repeat while `pending > 0` |
| GET | `/api/areas/status` | Which Zillow datasets are loaded, and cache counts |
| GET / POST | `/api/searches` | List saved searches / save one (`name`, `criteria`, `view`, `results`) |
| GET / PATCH / DELETE | `/api/searches/:id` | Open / update or rename / delete a saved search |
| POST | `/api/admin/zillow-import?dataset=<id\|next>` | Import one Zillow dataset now (needs `Authorization: Bearer $ADMIN_TOKEN`) |

## Safety

Painting is designed for a passenger, or for a driver who has pulled over. Don't tap the screen while driving.
