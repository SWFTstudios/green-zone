# Green Zone

Driving for dollars made easier. Drive a neighborhood, tap **Green**, **Yellow** or **Red**, and the street you're on gets painted that color on the map as you go. When the trip is done, name it, write notes, and fill in the key that explains what each color meant. Every trip is saved to your account, and you can get a summary by email.

| Color | Default meaning (editable) |
| --- | --- |
| 🟩 Green zone | Good neighborhood. Feels safe; I'd walk here or let my kids play outside. Homes and yards are well kept. |
| 🟨 Yellow zone | Mixed or changing. Some vacant or run-down houses, so use caution. Could be an opportunity. |
| 🟥 Red zone | Sketchy. I wouldn't feel safe walking here or letting my kids play outside. Lots of boarded-up or abandoned properties. |

## Features

**Free (real estate)**
- Sign in with an emailed 6-digit code. There are no passwords.
- **Drive** screen with big color buttons. Tap a color to start painting. Tap another color when the neighborhood changes, tap the same color or **Pause** to stop, and **Undo** to remove the last stretch.
- GPS painting that skips weak fixes and GPS jumps, keeps the screen awake, and follows your location.
- **Draw mode (✎)** for painting by tapping along streets, so you can mark areas from home or on a laptop.
- **Add note** drops a pin where you are, for example "vacant house, overgrown yard, 412 Maple".
- The trip in progress is saved on the phone, so it survives a refresh, a dead tab or lost signal. Uploads are safe to retry and never create duplicates.
- **Finish trip** lets you name the drive, add a note for each color you used ("what you saw on this trip"), write general notes, and optionally email yourself a summary.
- **Trips** lists every drive with a color breakdown. Open one to see it on the map with its key, edit it, or delete it.
- **My map** shows everything you've ever painted, with per-color mileage and filters.
- **Key** lets you rewrite what Green, Yellow and Red mean to you.

**Pro (any use case)**
- Add your own zones with any name and color, for example *Purple: a community we want to reach out to*. Up to 24 zones.
- Rename and recolor Green, Yellow and Red.
- If someone drops back to Free, their custom zones are locked for new drives, but old trips keep their colors.

## Tech

- **Cloudflare Workers** runs the API (`src/`) and serves the front end (`public/`) as static assets.
- **Cloudflare D1** stores users, sessions, sign-in codes, zones, trips, painted segments and note pins (`migrations/`).
- **Cloudflare Email Service** (`send_email` binding) sends sign-in codes, the welcome email and trip summaries.
- The front end is plain JavaScript with [Leaflet](https://leafletjs.com/) (served from `public/vendor/`) and OpenStreetMap tiles. It has no build step and can be installed to a phone's home screen.

Security notes: sign-in codes and session tokens are stored only as SHA-256 hashes. Codes expire after 10 minutes, allow 5 attempts, and are limited to 5 per email per hour. Sessions use an `HttpOnly`, `SameSite=Lax` cookie, and the API also rejects cross-site POST, PATCH and DELETE requests. Every query is scoped to the signed-in user.

## Run locally

```bash
npm install
cp .dev.vars.example .dev.vars     # DEV_MODE=1 shows the sign-in code on screen
npm run db:migrate:local
npm run dev                        # http://localhost:8787
```

Locally, emails aren't sent. Wrangler prints them to the console and saves them under `.wrangler/tmp/email/`.

Phones only allow GPS on `https://` pages or `localhost`. To try it on a phone during development, use `npx wrangler dev --remote` or a tunnel such as `cloudflared tunnel --url http://localhost:8787`.

## Deploy to Cloudflare

1. **Create the database** and paste the printed `database_id` into `wrangler.jsonc`:
   ```bash
   npx wrangler d1 create green-zone-db
   npm run db:migrate:remote
   ```
2. **Set up email sending.** In the Cloudflare dashboard, go to **Compute → Email Service → Email Sending → Onboard Domain** and pick your domain. The domain must use Cloudflare DNS. Sending to any address requires the Workers Paid plan.
3. **Set the sender** in `wrangler.jsonc`, under `vars`:
   - `EMAIL_FROM`, for example `login@yourdomain.com`. It must be on the onboarded domain.
   - `EMAIL_FROM_NAME`, for example `Green Zone`.
   - `PRO_EMAILS`, a comma-separated list of emails that always get Pro (optional).
   - Leave `DEV_MODE` empty. If it were set, sign-in codes would be shown to anyone.
4. **Deploy:**
   ```bash
   npm run deploy
   ```

### Giving someone Pro

Online checkout isn't connected yet. To give someone Pro, either add their email to `PRO_EMAILS` and redeploy, or run:

```bash
npx wrangler d1 execute green-zone-db --remote \
  --command "UPDATE users SET plan='pro' WHERE email='someone@example.com'"
```

A payment provider such as Stripe can set the same `plan` column from a webhook later.

### Map tiles

The app uses the public OpenStreetMap tile server, which is fine for light use. Before heavy production traffic, switch the tile URL in `public/app.js` to a tile provider you have an account with (MapTiler, Stadia, Mapbox and others), per the [OSM tile usage policy](https://operations.osmfoundation.org/policies/tiles/).

## API

All routes are under `/api` and use JSON. Everything except auth needs the session cookie.

| Method | Path | Purpose |
| --- | --- | --- |
| POST | `/api/auth/request` | `{email}` → email a sign-in code |
| POST | `/api/auth/verify` | `{email, code}` → start a session; creates the account on first sign-in |
| POST | `/api/auth/logout` | End the session |
| GET | `/api/me` | Current user and plan |
| GET / POST | `/api/zones` | List zones / add a zone (Pro) |
| PATCH / DELETE | `/api/zones/:id` | Edit a zone's meaning (all plans) or its name and color (Pro) / remove a custom zone (Pro) |
| GET / POST | `/api/trips` | List trips / save a finished trip (segments, pins, key notes, `emailSummary`) |
| GET / PATCH / DELETE | `/api/trips/:id` | Trip with segments and pins / edit name, notes and key notes / delete |
| GET | `/api/map` | Every segment and pin for the "My map" view |

## Safety

Painting is designed for a passenger, or for a driver who has pulled over. Don't tap the screen while driving.
