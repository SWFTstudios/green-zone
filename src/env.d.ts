// Secrets and optional overrides that aren't declared in wrangler.jsonc `vars`.
interface Env {
  /** Free key from api.census.gov/data/key_signup.html; without it the Census API allows ~500 calls/day. */
  CENSUS_API_KEY?: string;
  /** Enables POST /api/admin/zillow-import when set (`wrangler secret put ADMIN_TOKEN`). */
  ADMIN_TOKEN?: string;
  ACS_YEAR?: string;
  TIGERWEB_URL?: string;
  CENSUS_API_URL?: string;
  OVERPASS_URL?: string;
  ZILLOW_BASE_URL?: string;
}
