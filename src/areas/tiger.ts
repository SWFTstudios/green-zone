import { SourceError, fetchJson } from "./fetch";
import { type AreaGeometry, type BBox, geometryBBox, isAreaGeometry, roundGeometry } from "./geo";

/** Census TIGERweb map services: tract and ZIP (ZCTA) boundaries. Layer ids are looked up by name. */

const DEFAULT_TIGERWEB = "https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb";
const layerIds = new Map<string, number>();

export interface Tract {
  geoid: string;
  name: string;
  county: string;
  geometry: AreaGeometry;
  bbox: BBox;
  lat: number;
  lng: number;
  areaKm2: number;
}

export interface Zcta {
  zip: string;
  geometry: AreaGeometry;
  bbox: BBox;
}

function base(env: Env): string {
  return (env.TIGERWEB_URL || DEFAULT_TIGERWEB).replace(/\/+$/, "");
}

/** Picks a layer whose name matches; when several do, the one naming the latest year wins. */
export function pickLayer(layers: { id: number; name: string }[], pattern: RegExp): number | null {
  const matches = layers.filter((l) => pattern.test(l.name));
  if (!matches.length) return null;
  const year = (name: string) => Math.max(0, ...(name.match(/\b(19|20)\d{2}\b/g) || []).map(Number));
  matches.sort((a, b) => year(b.name) - year(a.name));
  return matches[0].id;
}

async function layerId(env: Env, service: string, pattern: RegExp): Promise<number> {
  const key = `${base(env)}/${service}|${pattern}`;
  const cached = layerIds.get(key);
  if (cached !== undefined) return cached;
  const info = await fetchJson<{ layers?: { id: number; name: string }[] }>(
    "Census TIGERweb",
    `${base(env)}/${service}/MapServer?f=json`,
  );
  const id = pickLayer(info.layers || [], pattern);
  if (id === null) throw new SourceError("Census TIGERweb", `no layer matching ${pattern} in ${service}`);
  layerIds.set(key, id);
  return id;
}

interface GeoJsonResponse {
  features?: { properties?: Record<string, unknown>; geometry?: unknown }[];
  error?: { message?: string };
}

async function queryLayer(env: Env, service: string, id: number, bbox: BBox, outFields: string) {
  const params = new URLSearchParams({
    where: "1=1",
    geometry: `${bbox.w},${bbox.s},${bbox.e},${bbox.n}`,
    geometryType: "esriGeometryEnvelope",
    inSR: "4326",
    spatialRel: "esriSpatialRelIntersects",
    outFields,
    returnGeometry: "true",
    outSR: "4326",
    geometryPrecision: "5",
    maxAllowableOffset: "0.0001",
    f: "geojson",
  });
  const data = await fetchJson<GeoJsonResponse>("Census TIGERweb", `${base(env)}/${service}/MapServer/${id}/query?${params}`);
  if (data.error) throw new SourceError("Census TIGERweb", data.error.message || "query failed");
  return (data.features || []).filter((f) => isAreaGeometry(f.geometry)) as {
    properties: Record<string, unknown>;
    geometry: AreaGeometry;
  }[];
}

function num(value: unknown): number | null {
  const n = typeof value === "number" ? value : parseFloat(String(value ?? ""));
  return Number.isFinite(n) ? n : null;
}

export async function fetchTracts(env: Env, bbox: BBox): Promise<Tract[]> {
  const service = "Tracts_Blocks";
  const id = await layerId(env, service, /^Census Tracts$/i);
  const features = await queryLayer(env, service, id, bbox, "GEOID,NAME,BASENAME,AREALAND,INTPTLAT,INTPTLON");
  return features.flatMap((f) => {
    const p = f.properties || {};
    const geoid = String(p.GEOID ?? "");
    if (!/^\d{11}$/.test(geoid)) return [];
    const geometry = roundGeometry(f.geometry);
    const box = geometryBBox(geometry);
    const lat = num(p.INTPTLAT) ?? (box.s + box.n) / 2;
    const lng = num(p.INTPTLON) ?? (box.w + box.e) / 2;
    const landM2 = num(p.AREALAND);
    const approxKm2 = (box.e - box.w) * 111.32 * Math.cos((lat * Math.PI) / 180) * (box.n - box.s) * 110.57 * 0.6;
    return [
      {
        geoid,
        name: String(p.NAME || (p.BASENAME ? `Census Tract ${p.BASENAME}` : `Tract ${geoid.slice(5)}`)),
        county: geoid.slice(0, 5),
        geometry,
        bbox: box,
        lat,
        lng,
        areaKm2: Math.max(0.01, landM2 ? landM2 / 1e6 : approxKm2),
      },
    ];
  });
}

export async function fetchZctas(env: Env, bbox: BBox): Promise<Zcta[]> {
  const service = "PUMA_TAD_TAZ_UGA_ZCTA";
  const id = await layerId(env, service, /ZIP Code Tabulation/i);
  const features = await queryLayer(env, service, id, bbox, "*");
  return features.flatMap((f) => {
    const p = f.properties || {};
    const zip = String(p.ZCTA5 ?? p.ZCTA5CE20 ?? p.GEOID ?? p.BASENAME ?? "");
    if (!/^\d{5}$/.test(zip)) return [];
    return [{ zip, geometry: f.geometry, bbox: geometryBBox(f.geometry) }];
  });
}
