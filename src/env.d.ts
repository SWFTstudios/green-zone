// Secrets and optional overrides that aren't declared in wrangler.jsonc `vars`.
interface Env {
  /** Free key from api.census.gov/data/key_signup.html; the Census API now rejects requests without one. */
  CENSUS_API_KEY?: string;
  /** Enables POST /api/admin/zillow-import when set (`wrangler secret put ADMIN_TOKEN`). */
  ADMIN_TOKEN?: string;
  ACS_YEAR?: string;
  TIGERWEB_URL?: string;
  CENSUS_API_URL?: string;
  OVERPASS_URL?: string;
  ZILLOW_BASE_URL?: string;
  /** CDC PLACES (Socrata) host and tract dataset id; an app token raises Socrata's rate limit. */
  CDC_PLACES_URL?: string;
  CDC_PLACES_DATASET?: string;
  SOCRATA_APP_TOKEN?: string;
  /** NASA night-lights tile template ({z}/{x}/{y}) and the zoom it is sampled at. */
  NIGHT_LIGHTS_TILES?: string;
  NIGHT_LIGHTS_ZOOM?: string;
  /** FEMA National Flood Hazard Layer map service and FRED's mortgage-rate CSV, for mirrors or tests. */
  FEMA_NFHL_URL?: string;
  FRED_CSV_URL?: string;
  /** Optional RentCast key for per-ZIP listing snapshots; metered, so calls are capped per month. */
  RENTCAST_API_KEY?: string;
  RENTCAST_URL?: string;
  RENTCAST_MONTHLY_LIMIT?: string;
  /** Inbox that receives reviews. A secret, so the address never appears in the public repo or the page. */
  REVIEW_TO?: string;
}
