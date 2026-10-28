import type { User } from "../auth";
import { HttpError, json, readJson } from "../http";
import { type AcsMetrics, acsUrl, parseAcsResponse } from "./acs.ts";
import { SourceError, fetchChecked, fetchJson, fetchText } from "./fetch";
import { DEFAULT_FEMA_NFHL, exportSize, floodExportUrl, floodTileTemplate, sampleCoverage } from "./flood.ts";
import {
  type AreaGeometry,
  type BBox,
  bboxSpan,
  findContaining,
  parseBBox,
  tileBBox,
  tilesFor,
  unionBBox,
} from "./geo.ts";
import { decode } from "fast-png";
import { type DecodedTile, sampleNightLights, tileUrl, tilesForBBox } from "./nightlights.ts";
import { type OsmCounts, type OsmElement, aggregateOsm, landUseSummary, overpassQuery } from "./osm.ts";
import { DEFAULT_FRED_CSV, type MortgageRate, monthlyPayment, parseFredCsv } from "./mortgage.ts";
import { parsePlaces, placesUrl } from "./places.ts";
import { DEFAULT_RENTCAST, type MarketSnapshot, parseRentcastMarket, rentcastMarketUrl } from "./rentcast.ts";
import { type Tract, fetchTracts, fetchZctas } from "./tiger";
import { ZILLOW_DATASETS, canSelfImport, importStatus } from "./zillow";

const TILE_DEG = 0.1;
const MAX_SPAN_DEG = 0.6;
const TILES_PER_REQUEST = 4;
const METRICS_PER_REQUEST = 30;
const OSM_SPAN_CAP_DEG = 0.12;
const METRICS_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const PARTIAL_RETRY_MS = 15 * 60 * 1000;
const ACS_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const PLACES_TTL_MS = 90 * 24 * 60 * 60 * 1000;
const DEFAULT_CENSUS = "https://api.census.gov/data";
const DEFAULT_OVERPASS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
].join(",");
const DEFAULT_PLACES = "https://data.cdc.gov";
const DEFAULT_PLACES_DATASET = "cwsq-ngmh";
export const DEFAULT_NIGHT_TILES =
  "https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/VIIRS_Black_Marble/default/2016-01-01/GoogleMapsCompatible_Level8/{z}/{y}/{x}.png";
const MAX_NIGHT_TILES = 4;
const RATE_TTL_MS = 12 * 60 * 60 * 1000;
const RENTCAST_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const RENTCAST_MONTHLY_LIMIT = 45;
/** Bump when the shape of cached metrics changes, so tracts are recomputed. */
const METRICS_VERSION = 3;
/** Bump when ACS_VARIABLES change, so cached county responses are refetched. */
const ACS_CACHE_VERSION = 2;

interface AreaRow {
  geoid: string;
  name: string;
  county: string;
  geometry: string;
  w: number;
  s: number;
  e: number;
  n: number;
  lat: number;
  lng: number;
  area_km2: number;
  metrics: string | null;
  metrics_at: number | null;
}

/** What's cached per tract. Zillow values are joined in at read time so monthly imports show up immediately. */
export interface CachedMetrics extends Partial<AcsMetrics> {
  zip: string | null;
  areaKm2: number;
  acsYear: string | null;
  popDensity: number | null;
  litPerKm2: number | null;
  pathsPerKm2: number | null;
  parks: number | null;
  outdoorPerKm2: number | null;
  fitnessPerKm2: number | null;
  transitPerKm2: number | null;
  grocery: number | null;
  schools: number | null;
  foodPerKm2: number | null;
  healthcare: number | null;
  landUse: string | null;
  landUseMix: Record<string, number> | null;
  activeAdults: number | null;
  nightLight: number | null;
  floodShare: number | null;
  missing: string[];
  v: number;
}

function round(value: number, decimals = 2): number {
  const f = 10 ** decimals;
  return Math.round(value * f) / f;
}

function osmMetrics(c: OsmCounts | undefined, km2: number) {
  if (!c) {
    return {
      litPerKm2: null,
      pathsPerKm2: null,
      parks: null,
      outdoorPerKm2: null,
      fitnessPerKm2: null,
      transitPerKm2: null,
      grocery: null,
      schools: null,
      foodPerKm2: null,
      healthcare: null,
      landUse: null,
      landUseMix: null,
    };
  }
  const per = (n: number) => round(n / km2, 2);
  const land = landUseSummary(c.landuse);
  return {
    litPerKm2: per(c.litWays + c.streetLamps * 0.5),
    pathsPerKm2: per(c.paths),
    parks: c.parks + c.playgrounds,
    outdoorPerKm2: per(c.parks + c.playgrounds + c.fitness + c.paths * 0.25),
    fitnessPerKm2: per(c.fitness),
    transitPerKm2: per(c.transit),
    grocery: c.grocery,
    schools: c.schools,
    foodPerKm2: per(c.food),
    healthcare: c.healthcare,
    landUse: land.dominant,
    landUseMix: Object.keys(land.mix).length ? land.mix : null,
  };
}

async function countyAcs(env: Env, county: string): Promise<{ year: string; data: Record<string, AcsMetrics> }> {
  const cached = await env.DB.prepare("SELECT year, data, fetched_at FROM acs_cache WHERE county = ?")
    .bind(county)
    .first<{ year: string; data: string; fetched_at: number }>();
  const [cachedYear, cachedVersion] = (cached?.year || "").split("@");
  const cachedCurrent = cached && Number(cachedVersion) === ACS_CACHE_VERSION;
  if (cached && cachedCurrent && Date.now() - cached.fetched_at < ACS_TTL_MS) {
    return { year: cachedYear, data: JSON.parse(cached.data) };
  }

  const base = env.CENSUS_API_URL || DEFAULT_CENSUS;
  const first = Number(env.ACS_YEAR) || new Date().getUTCFullYear() - 2;
  let lastError: unknown;
  // The newest 5-year release lands each December, so fall back a year or two if it isn't out.
  for (const year of [first, first - 1, first - 2].map(String)) {
    try {
      const rows = await fetchJson<string[][]>("Census ACS", acsUrl(base, year, county, env.CENSUS_API_KEY));
      const data = parseAcsResponse(rows);
      await env.DB.prepare(
        `INSERT INTO acs_cache (county, year, data, fetched_at) VALUES (?, ?, ?, ?)
         ON CONFLICT(county) DO UPDATE SET year = excluded.year, data = excluded.data, fetched_at = excluded.fetched_at`,
      )
        .bind(county, `${year}@${ACS_CACHE_VERSION}`, JSON.stringify(data), Date.now())
        .run();
      return { year, data };
    } catch (err) {
      lastError = err;
      // An older year won't fix a key problem.
      if (err instanceof Error && /API key/.test(err.message)) break;
    }
  }
  if (cached) return { year: cachedYear, data: JSON.parse(cached.data) };
  throw lastError;
}

async function cached<T>(env: Env, key: string, ttlMs: number, load: () => Promise<T>): Promise<T> {
  const row = await env.DB.prepare("SELECT data, fetched_at FROM source_cache WHERE key = ?")
    .bind(key)
    .first<{ data: string; fetched_at: number }>();
  if (row && Date.now() - row.fetched_at < ttlMs) return JSON.parse(row.data) as T;
  const value = await load();
  await env.DB.prepare(
    `INSERT INTO source_cache (key, data, fetched_at) VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET data = excluded.data, fetched_at = excluded.fetched_at`,
  )
    .bind(key, JSON.stringify(value), Date.now())
    .run();
  return value;
}

/** CDC PLACES "active adults" for every tract in a county. */
function countyPlaces(env: Env, county: string): Promise<Record<string, number>> {
  const dataset = env.CDC_PLACES_DATASET || DEFAULT_PLACES_DATASET;
  return cached(env, `places:${dataset}:${county}`, PLACES_TTL_MS, async () =>
    parsePlaces(
      await fetchJson("CDC PLACES", placesUrl(env.CDC_PLACES_URL || DEFAULT_PLACES, dataset, county, env.SOCRATA_APP_TOKEN)),
    ),
  );
}

export function nightTileTemplate(env: Env): { url: string; zoom: number } {
  return { url: env.NIGHT_LIGHTS_TILES || DEFAULT_NIGHT_TILES, zoom: Number(env.NIGHT_LIGHTS_ZOOM) || 8 };
}

async function fetchPng(source: string, url: string, timeoutMs = 20000): Promise<DecodedTile> {
  const res = await fetchChecked(source, url, {}, timeoutMs);
  const type = res.headers.get("content-type") || "";
  // Map services report errors as JSON or HTML with a 200 status.
  if (type && !type.includes("image")) throw new SourceError(source, `unexpected response ${(await res.text()).slice(0, 160).replace(/\s+/g, " ")}`);
  let png: ReturnType<typeof decode>;
  try {
    png = decode(new Uint8Array(await res.arrayBuffer()));
  } catch {
    throw new SourceError(source, "image could not be read");
  }
  return { width: png.width, height: png.height, channels: png.channels, data: png.data, palette: png.palette };
}

/** NASA night-lights brightness (0–100) per tract, from the overlay's own PNG tiles. */
async function nightLights(env: Env, tracts: Tract[], union: BBox): Promise<Map<string, number>> {
  const { url, zoom } = nightTileTemplate(env);
  const coords = tilesForBBox(union, zoom);
  if (coords.length > MAX_NIGHT_TILES) throw new SourceError("NASA night lights", "area too large");
  const tiles = await Promise.all(
    coords.map(async ({ x, y }) => ({ x, y, z: zoom, img: await fetchPng("NASA night lights", tileUrl(url, zoom, x, y)) })),
  );
  return sampleNightLights(tiles, tracts);
}

export function femaBase(env: Env): string {
  return env.FEMA_NFHL_URL || DEFAULT_FEMA_NFHL;
}

/** Share of each tract inside FEMA's 1%-a-year floodplain, from one map export over the batch. */
async function floodShares(env: Env, tracts: Tract[], union: BBox): Promise<Map<string, number>> {
  const img = await fetchPng("FEMA flood zones", floodExportUrl(femaBase(env), union, exportSize(union)), 45000);
  return sampleCoverage(img, union, tracts);
}

/** The latest 30-year mortgage rate, refreshed twice a day. */
export function mortgageRate(env: Env): Promise<MortgageRate> {
  return cached(env, "fred:MORTGAGE30US", RATE_TTL_MS, async () => {
    const rate = parseFredCsv(await fetchText("FRED mortgage rate", env.FRED_CSV_URL || DEFAULT_FRED_CSV));
    if (!rate) throw new SourceError("FRED mortgage rate", "no rate in the download");
    return rate;
  });
}

/** Tries each Overpass server in turn; public instances often rate-limit or time out. */
async function overpass(env: Env, bbox: BBox): Promise<OsmElement[]> {
  const servers = (env.OVERPASS_URL || DEFAULT_OVERPASS).split(",").map((s) => s.trim()).filter(Boolean);
  let lastError: unknown;
  for (const server of servers) {
    try {
      const data = await fetchJson<{ elements?: OsmElement[]; remark?: string }>(
        "OpenStreetMap (Overpass)",
        server,
        {
          method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded" },
          body: `data=${encodeURIComponent(overpassQuery(bbox))}`,
        },
        servers.length > 1 ? 45000 : 70000,
      );
      if (data.remark && /error|timeout|out of memory/i.test(data.remark) && !data.elements?.length) {
        throw new SourceError("OpenStreetMap (Overpass)", data.remark.slice(0, 160));
      }
      return data.elements || [];
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError;
}

function toTract(row: AreaRow): Tract {
  return {
    geoid: row.geoid,
    name: row.name,
    county: row.county,
    geometry: JSON.parse(row.geometry) as AreaGeometry,
    bbox: { w: row.w, s: row.s, e: row.e, n: row.n },
    lat: row.lat,
    lng: row.lng,
    areaKm2: row.area_km2,
  };
}

/** Fetches Census, OpenStreetMap and ZIP data for a batch of nearby tracts and caches the result. */
async function computeMetrics(env: Env, tracts: Tract[], notices: Set<string>): Promise<Map<string, CachedMetrics>> {
  const union = unionBBox(tracts.map((t) => t.bbox));
  const counties = [...new Set(tracts.map((t) => t.county))];

  const fail = (label: string) => (err: unknown) => {
    notices.add(err instanceof Error ? err.message : `${label} unavailable`);
    return null;
  };
  const [acsResults, osmResult, zctaResult, placesResults, nightResult, floodResult] = await Promise.all([
    Promise.allSettled(counties.map((c) => countyAcs(env, c))),
    overpass(env, union).then(
      (elements) => aggregateOsm(elements, tracts),
      (err) => {
        notices.add(err instanceof Error ? err.message : "OpenStreetMap unavailable");
        return null;
      },
    ),
    fetchZctas(env, union).catch(fail("ZIP boundaries")),
    Promise.allSettled(counties.map((c) => countyPlaces(env, c))),
    nightLights(env, tracts, union).catch(fail("NASA night lights")),
    floodShares(env, tracts, union).catch(fail("FEMA flood zones")),
  ]);
  const placesByCounty = new Map<string, Record<string, number>>();
  placesResults.forEach((r, i) => {
    if (r.status === "fulfilled") placesByCounty.set(counties[i], r.value);
    else notices.add(r.reason instanceof Error ? r.reason.message : "CDC PLACES unavailable");
  });

  const acsByCounty = new Map<string, { year: string; data: Record<string, AcsMetrics> }>();
  acsResults.forEach((r, i) => {
    if (r.status === "fulfilled") acsByCounty.set(counties[i], r.value);
    else notices.add(r.reason instanceof Error ? r.reason.message : "Census ACS unavailable");
  });

  const out = new Map<string, CachedMetrics>();
  for (const t of tracts) {
    const acsCounty = acsByCounty.get(t.county);
    const acs = acsCounty?.data[t.geoid];
    const missing: string[] = [];
    if (!acsCounty) missing.push("census");
    if (!osmResult) missing.push("osm");
    if (!zctaResult) missing.push("zip");
    if (!placesByCounty.has(t.county)) missing.push("cdc");
    if (!nightResult) missing.push("night");
    if (!floodResult) missing.push("flood");
    out.set(t.geoid, {
      ...(acs || {}),
      zip: zctaResult ? (findContaining(zctaResult, t.lng, t.lat)?.zip ?? null) : null,
      areaKm2: round(t.areaKm2, 3),
      acsYear: acsCounty?.year ?? null,
      popDensity: acs?.population != null ? round(acs.population / t.areaKm2, 0) : null,
      ...osmMetrics(osmResult?.get(t.geoid), t.areaKm2),
      activeAdults: placesByCounty.get(t.county)?.[t.geoid] ?? null,
      nightLight: nightResult?.get(t.geoid) ?? null,
      floodShare: floodResult?.get(t.geoid) ?? null,
      missing,
      v: METRICS_VERSION,
    });
  }

  const now = Date.now();
  const updates = [...out].map(([geoid, m]) =>
    env.DB.prepare("UPDATE area_cache SET metrics = ?, metrics_at = ? WHERE geoid = ?").bind(JSON.stringify(m), now, geoid),
  );
  for (let i = 0; i < updates.length; i += 50) await env.DB.batch(updates.slice(i, i + 50));
  return out;
}

function needsMetrics(row: AreaRow, now: number): boolean {
  if (!row.metrics || !row.metrics_at) return true;
  if (now - row.metrics_at > METRICS_TTL_MS) return true;
  const metrics = JSON.parse(row.metrics) as CachedMetrics;
  if (metrics.v !== METRICS_VERSION) return true;
  const missing = metrics.missing || [];
  return missing.length > 0 && now - row.metrics_at > PARTIAL_RETRY_MS;
}

/** Nearest stale tracts first, stopping before the combined box gets too big for one Overpass call. */
function pickBatch(rows: AreaRow[], center: [number, number]): AreaRow[] {
  const dist = (r: AreaRow) => (r.lng - center[0]) ** 2 + (r.lat - center[1]) ** 2;
  const sorted = [...rows].sort((a, b) => dist(a) - dist(b));
  const batch: AreaRow[] = [];
  for (const row of sorted) {
    if (batch.length >= METRICS_PER_REQUEST) break;
    const next = unionBBox([...batch, row].map((r) => ({ w: r.w, s: r.s, e: r.e, n: r.n })));
    if (batch.length && bboxSpan(next) > OSM_SPAN_CAP_DEG) continue;
    batch.push(row);
  }
  return batch;
}

async function loadTiles(env: Env, bbox: BBox, notices: Set<string>): Promise<number> {
  const center: [number, number] = [(bbox.w + bbox.e) / 2, (bbox.s + bbox.n) / 2];
  const tiles = tilesFor(bbox, TILE_DEG);
  const known = new Set(
    (
      await env.DB.prepare(`SELECT tile FROM area_tiles WHERE tile IN (${tiles.map(() => "?").join(",")})`)
        .bind(...tiles)
        .all<{ tile: string }>()
    ).results.map((r) => r.tile),
  );
  const tileCenter = (key: string) => {
    const b = tileBBox(key);
    return ((b.w + b.e) / 2 - center[0]) ** 2 + ((b.s + b.n) / 2 - center[1]) ** 2;
  };
  const missing = tiles.filter((t) => !known.has(t)).sort((a, b) => tileCenter(a) - tileCenter(b));
  const now = Date.now();
  let loaded = 0;
  for (const tile of missing.slice(0, TILES_PER_REQUEST)) {
    let tracts: Tract[];
    try {
      tracts = await fetchTracts(env, tileBBox(tile));
    } catch (err) {
      notices.add(err instanceof Error ? err.message : "Census boundaries unavailable");
      break;
    }
    const statements = tracts.map((t) =>
      env.DB.prepare(
        `INSERT OR IGNORE INTO area_cache (geoid, name, county, geometry, w, s, e, n, lat, lng, area_km2, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(t.geoid, t.name, t.county, JSON.stringify(t.geometry), t.bbox.w, t.bbox.s, t.bbox.e, t.bbox.n, t.lat, t.lng, t.areaKm2, now),
    );
    statements.push(env.DB.prepare("INSERT OR REPLACE INTO area_tiles (tile, fetched_at) VALUES (?, ?)").bind(tile, now));
    for (let i = 0; i < statements.length; i += 50) await env.DB.batch(statements.slice(i, i + 50));
    loaded++;
  }
  return missing.length - loaded;
}

interface ZipRow {
  zip: string;
  city: string | null;
  metro: string | null;
  zhvi: number | null;
  zhvi_yoy: number | null;
  zhvi_month: string | null;
  zhvi_sfr: number | null;
  zhvi_condo: number | null;
  zhvi_1br: number | null;
  zhvi_2br: number | null;
  zhvi_3br: number | null;
  zhvi_4br: number | null;
  zhvi_5br: number | null;
  zori: number | null;
  zori_yoy: number | null;
  zori_month: string | null;
}

function withMarket(m: CachedMetrics, z: ZipRow | undefined, rate: MortgageRate | null) {
  const zhvi = z?.zhvi ?? null;
  const zori = z?.zori ?? null;
  const price = zhvi ?? m.medianHomeValue ?? null;
  const rent = zori ?? m.medianRent ?? null;
  const payment = rate && price ? Math.round(monthlyPayment(price, rate.rate)) : null;
  const grossYield =
    zhvi && zori
      ? round((zori * 12) / zhvi, 4)
      : m.medianHomeValue && m.medianRent
        ? round((m.medianRent * 12) / m.medianHomeValue, 4)
        : null;
  return {
    ...m,
    city: z?.city ?? null,
    metro: z?.metro ?? null,
    zhvi,
    zhviYoY: z?.zhvi_yoy ?? null,
    zhviSfr: z?.zhvi_sfr ?? null,
    zhviCondo: z?.zhvi_condo ?? null,
    zhvi1br: z?.zhvi_1br ?? null,
    zhvi2br: z?.zhvi_2br ?? null,
    zhvi3br: z?.zhvi_3br ?? null,
    zhvi4br: z?.zhvi_4br ?? null,
    zhvi5br: z?.zhvi_5br ?? null,
    zori,
    zoriYoY: z?.zori_yoy ?? null,
    zillowMonth: z?.zhvi_month ?? z?.zori_month ?? null,
    grossYield,
    mortgagePayment: payment,
    rentCoverage: payment && rent ? round(rent / payment, 3) : null,
  };
}

async function marketByZip(env: Env, zips: string[]): Promise<Map<string, ZipRow>> {
  const out = new Map<string, ZipRow>();
  for (let i = 0; i < zips.length; i += 90) {
    const chunk = zips.slice(i, i + 90);
    const { results } = await env.DB.prepare(
      `SELECT zip, city, metro, zhvi, zhvi_yoy, zhvi_month, zhvi_sfr, zhvi_condo, zhvi_1br, zhvi_2br, zhvi_3br,
              zhvi_4br, zhvi_5br, zori, zori_yoy, zori_month
       FROM zip_market WHERE zip IN (${chunk.map(() => "?").join(",")})`,
    )
      .bind(...chunk)
      .all<ZipRow>();
    for (const r of results) out.set(r.zip, r);
  }
  return out;
}

/**
 * POST /api/areas  { bbox: "w,s,e,n", have?: string[] }
 * Returns tracts in view with metrics. Boundaries the client already has (`have`) are omitted.
 * Work is spread over several calls; `pending` tells the client to ask again shortly.
 */
export async function queryAreas(request: Request, env: Env, _user: User): Promise<Response> {
  const body = await readJson<{ bbox?: string; have?: unknown }>(request);
  const bbox = parseBBox(typeof body.bbox === "string" ? body.bbox : null);
  if (!bbox) throw new HttpError(400, "bbox must be 'west,south,east,north'.", "validation");
  if (bboxSpan(bbox) > MAX_SPAN_DEG) return json({ tooLarge: true, areas: [], pending: 0, notices: [] });
  const have = new Set(Array.isArray(body.have) ? body.have.filter((g): g is string => typeof g === "string").slice(0, 3000) : []);

  const notices = new Set<string>();
  const tilesPending = await loadTiles(env, bbox, notices);

  const { results: rows } = await env.DB.prepare(
    `SELECT geoid, name, county, geometry, w, s, e, n, lat, lng, area_km2, metrics, metrics_at
     FROM area_cache WHERE e >= ? AND w <= ? AND n >= ? AND s <= ? LIMIT 1500`,
  )
    .bind(bbox.w, bbox.e, bbox.s, bbox.n)
    .all<AreaRow>();

  const now = Date.now();
  const stale = rows.filter((r) => needsMetrics(r, now));
  let computed = 0;
  if (stale.length) {
    const batch = pickBatch(stale, [(bbox.w + bbox.e) / 2, (bbox.s + bbox.n) / 2]);
    try {
      const fresh = await computeMetrics(env, batch.map(toTract), notices);
      for (const row of batch) {
        const m = fresh.get(row.geoid);
        if (m) {
          row.metrics = JSON.stringify(m);
          row.metrics_at = now;
          computed++;
        }
      }
    } catch (err) {
      notices.add(err instanceof Error ? err.message : "Area data unavailable");
    }
  }

  const metricsByGeoid = new Map(rows.map((r) => [r.geoid, r.metrics ? (JSON.parse(r.metrics) as CachedMetrics) : null]));
  const zips = [...new Set([...metricsByGeoid.values()].flatMap((m) => (m?.zip ? [m.zip] : [])))];
  const [market, rate] = await Promise.all([
    marketByZip(env, zips),
    mortgageRate(env).catch((err) => {
      notices.add(err instanceof Error ? err.message : "Mortgage rate unavailable");
      return null;
    }),
  ]);
  const partial = rows.filter((r) => {
    const m = metricsByGeoid.get(r.geoid);
    return m && m.missing?.length;
  }).length;

  return json({
    areas: rows.map((r) => {
      const m = metricsByGeoid.get(r.geoid);
      return {
        geoid: r.geoid,
        name: r.name,
        ...(have.has(r.geoid) ? {} : { geometry: JSON.parse(r.geometry) }),
        metrics: m ? withMarket(m, m.zip ? market.get(m.zip) : undefined, rate) : null,
      };
    }),
    pending: Math.max(0, stale.length - computed) + tilesPending,
    partial,
    notices: [...notices],
  });
}

/** GET /api/areas/status: which data sources are loaded, for the "About this data" panel. */
export async function areaStatus(env: Env): Promise<Response> {
  const imports = new Map((await importStatus(env)).map((r) => [r.dataset, r]));
  const counts = await env.DB.prepare(
    "SELECT (SELECT COUNT(*) FROM zip_market) AS zips, (SELECT COUNT(*) FROM area_cache WHERE metrics IS NOT NULL) AS areas",
  ).first<{ zips: number; areas: number }>();
  return json({
    zillow: ZILLOW_DATASETS.map((d) => {
      const s = imports.get(d.id);
      return { id: d.id, label: d.label, month: s?.month ?? null, rows: s?.rows ?? 0, importedAt: s?.imported_at ?? null, error: s?.error ?? null };
    }),
    zips: counts?.zips ?? 0,
    areasCached: counts?.areas ?? 0,
    canLoadMarket: await canSelfImport(env),
    nightLights: nightTileTemplate(env),
    floodTiles: floodTileTemplate(femaBase(env)),
    mortgageRate: await mortgageRate(env).catch(() => null),
    rentcast: !!env.RENTCAST_API_KEY,
  });
}

/**
 * GET /api/areas/market/:zip  RentCast listings snapshot for one ZIP, if a RentCast key is set.
 * Cached for 30 days per ZIP, and capped per month to stay inside the plan.
 */
export async function marketSnapshot(env: Env, zip: string): Promise<Response> {
  if (!env.RENTCAST_API_KEY) throw new HttpError(404, "Market snapshots aren't switched on.", "not_found");
  if (!/^\d{5}$/.test(zip)) throw new HttpError(400, "ZIP must be 5 digits.", "validation");
  const key = `rentcast:${zip}`;
  const hit = await env.DB.prepare("SELECT data, fetched_at FROM source_cache WHERE key = ?").bind(key).first<{ data: string; fetched_at: number }>();
  if (hit && Date.now() - hit.fetched_at < RENTCAST_TTL_MS) return json({ snapshot: JSON.parse(hit.data) as MarketSnapshot, cached: true });

  const month = new Date().toISOString().slice(0, 7);
  const limit = Number(env.RENTCAST_MONTHLY_LIMIT) || RENTCAST_MONTHLY_LIMIT;
  const counter = await env.DB.prepare(
    `INSERT INTO source_cache (key, data, fetched_at) VALUES (?, '1', ?)
     ON CONFLICT(key) DO UPDATE SET data = CAST(data AS INTEGER) + 1 WHERE CAST(source_cache.data AS INTEGER) < ?`,
  )
    .bind(`rentcast:calls:${month}`, Date.now(), limit)
    .run();
  if (!(counter.meta.changes ?? 0)) {
    if (hit) return json({ snapshot: JSON.parse(hit.data) as MarketSnapshot, cached: true, stale: true });
    throw new HttpError(429, "This month's market snapshots are used up. They reset next month.", "rate_limited");
  }
  const body = await fetchJson<unknown>("RentCast", rentcastMarketUrl(env.RENTCAST_URL || DEFAULT_RENTCAST, zip), {
    headers: { "X-Api-Key": env.RENTCAST_API_KEY },
  });
  const snapshot = parseRentcastMarket(zip, body);
  await env.DB.prepare(
    `INSERT INTO source_cache (key, data, fetched_at) VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET data = excluded.data, fetched_at = excluded.fetched_at`,
  )
    .bind(key, JSON.stringify(snapshot), Date.now())
    .run();
  return json({ snapshot, cached: false });
}
