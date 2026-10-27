// Offline stand-in for TIGERweb, the Census API, Overpass and Zillow's CSVs, for local development
// and tests. It serves a synthetic grid of tracts around Philadelphia with made-up numbers.
//   node test/mock-data-server.mjs [port]
// then point TIGERWEB_URL, CENSUS_API_URL, OVERPASS_URL and ZILLOW_BASE_URL in .dev.vars at it.
import http from "node:http";

const PORT = Number(process.argv[2] || 8790);
const GRID = { w: -75.3, s: 39.86, e: -75.0, n: 40.1, step: 0.02 };
const ZIP_STEP = 0.06;
const COLS = Math.round((GRID.e - GRID.w) / GRID.step);
const ROWS = Math.round((GRID.n - GRID.s) / GRID.step);

function rand(seed) {
  let x = Math.sin(seed * 9301 + 49297) * 233280;
  return x - Math.floor(x);
}

const tracts = [];
for (let i = 0; i < COLS; i++) {
  for (let j = 0; j < ROWS; j++) {
    const w = +(GRID.w + i * GRID.step).toFixed(5);
    const s = +(GRID.s + j * GRID.step).toFixed(5);
    const id = i * 100 + j;
    tracts.push({ i, j, w, s, e: +(w + GRID.step).toFixed(5), n: +(s + GRID.step).toFixed(5), tract: String(id).padStart(6, "0"), id });
  }
}

const zipFor = (lng, lat) => {
  const zi = Math.floor((lng - GRID.w) / ZIP_STEP);
  const zj = Math.floor((lat - GRID.s) / ZIP_STEP);
  return String(19100 + zi * 5 + zj).padStart(5, "0");
};

const square = (w, s, e, n) => ({ type: "Polygon", coordinates: [[[w, s], [e, s], [e, n], [w, n], [w, s]]] });
const intersects = (a, b) => a.w <= b.e && a.e >= b.w && a.s <= b.n && a.n >= b.s;

function envelope(params) {
  const [w, s, e, n] = (params.get("geometry") || "").split(",").map(Number);
  return { w, s, e, n };
}

function tractQuery(env) {
  return {
    type: "FeatureCollection",
    features: tracts
      .filter((t) => intersects(t, env))
      .map((t) => ({
        type: "Feature",
        properties: {
          GEOID: `42101${t.tract}`,
          NAME: `Census Tract ${t.id / 100}`,
          BASENAME: String(t.id / 100),
          AREALAND: Math.round(2.0 * 2.2 * 1e6 * 0.85),
          INTPTLAT: `+${((t.s + t.n) / 2).toFixed(6)}`,
          INTPTLON: ((t.w + t.e) / 2).toFixed(6),
        },
        geometry: square(t.w, t.s, t.e, t.n),
      })),
  };
}

function zctaQuery(env) {
  const features = [];
  for (let zi = 0; zi * ZIP_STEP < GRID.e - GRID.w; zi++) {
    for (let zj = 0; zj * ZIP_STEP < GRID.n - GRID.s; zj++) {
      const b = { w: GRID.w + zi * ZIP_STEP, s: GRID.s + zj * ZIP_STEP, e: GRID.w + (zi + 1) * ZIP_STEP, n: GRID.s + (zj + 1) * ZIP_STEP };
      if (!intersects(b, env)) continue;
      features.push({ type: "Feature", properties: { ZCTA5: zipFor(b.w + 0.001, b.s + 0.001), GEOID: "x" }, geometry: square(b.w, b.s, b.e, b.n) });
    }
  }
  return { type: "FeatureCollection", features };
}

function acs(params) {
  const vars = (params.get("get") || "").split(",");
  const header = [...vars, "state", "county", "tract"];
  const rows = tracts.map((t) => {
    const east = t.i / COLS; // 0 west .. 1 east: east side is "better" in the mock
    const r = rand(t.id);
    const units = 1500 + Math.round(r * 1000);
    const occupied = Math.round(units * (0.8 + east * 0.15));
    const values = {
      NAME: `Census Tract ${t.id / 100}; Philadelphia County; Pennsylvania`,
      B01003_001E: 3000 + Math.round(r * 3000),
      B25077_001E: Math.round(150000 + east * 300000 + r * 40000),
      B25064_001E: Math.round(1100 + east * 800 + r * 200),
      B19013_001E: Math.round(35000 + east * 60000 + r * 10000),
      B25002_001E: units,
      B25002_003E: units - occupied,
      B25003_001E: occupied,
      B25003_002E: Math.round(occupied * (0.35 + east * 0.4)),
      B25035_001E: Math.round(1930 + east * 50 + r * 10),
      B23025_003E: 2000,
      B23025_005E: Math.round(2000 * (0.11 - east * 0.07)),
      B25024_001E: units,
      B25024_002E: Math.round(units * 0.3),
      B25024_003E: Math.round(units * 0.3),
      B25024_004E: Math.round(units * 0.1),
      B25024_005E: Math.round(units * 0.1),
      B25024_006E: Math.round(units * 0.05),
      B25024_007E: Math.round(units * 0.05),
      B25024_008E: Math.round(units * 0.05),
      B25024_009E: Math.round(units * 0.05),
      B25024_010E: 0,
    };
    if (t.id % 17 === 0) values.B25064_001E = -666666666;
    return [...vars.map((v) => String(values[v] ?? 0)), "42", "101", t.tract];
  });
  return [header, ...rows];
}

function overpass(query) {
  const m = query.match(/\[bbox:([-\d.]+),([-\d.]+),([-\d.]+),([-\d.]+)\]/);
  if (!m) return { elements: [] };
  const [s, w, n, e] = m.slice(1).map(Number);
  const elements = [];
  const step = 0.004;
  for (let lng = Math.ceil(w / step) * step; lng < e; lng += step) {
    for (let lat = Math.ceil(s / step) * step; lat < n; lat += step) {
      const seed = Math.round(lng * 10000) * 7 + Math.round(lat * 10000);
      const r = rand(seed);
      const north = (lat - GRID.s) / (GRID.n - GRID.s); // north side is greener and better lit
      const at = { lat: +lat.toFixed(5), lon: +lng.toFixed(5) };
      if (r < 0.3 + north * 0.6) elements.push({ type: "way", id: seed, center: at, tags: { highway: "residential", lit: "yes" } });
      if (r < 0.2 + north * 0.5) elements.push({ type: "node", id: seed + 1, ...at, tags: { highway: "street_lamp" } });
      if (rand(seed + 3) < north * 0.25) elements.push({ type: "way", id: seed + 2, center: at, tags: { leisure: "park" } });
      if (rand(seed + 5) < north * 0.3) elements.push({ type: "way", id: seed + 4, center: at, tags: { highway: "footway" } });
      if (rand(seed + 7) < 0.05) elements.push({ type: "node", id: seed + 6, ...at, tags: { shop: "supermarket" } });
      if (rand(seed + 9) < 0.2) elements.push({ type: "node", id: seed + 8, ...at, tags: { highway: "bus_stop" } });
      if (rand(seed + 11) < 0.1) elements.push({ type: "node", id: seed + 10, ...at, tags: { amenity: "cafe" } });
      elements.push({ type: "way", id: seed + 12, center: at, tags: { landuse: rand(seed + 13) < 0.8 ? "residential" : "commercial" } });
    }
  }
  return { version: 0.6, elements };
}

function zillowCsv(path) {
  const months = Array.from({ length: 24 }, (_, k) => {
    const d = new Date(Date.UTC(2024, 9 + k, 1));
    const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0));
    return last.toISOString().slice(0, 10);
  });
  const zips = new Set(tracts.map((t) => zipFor((t.w + t.e) / 2, (t.s + t.n) / 2)));
  const isRent = path.includes("zori");
  const lines = [`RegionID,SizeRank,RegionName,RegionType,StateName,State,City,Metro,CountyName,${months.join(",")}`];
  let k = 0;
  for (const zip of zips) {
    const base = isRent ? 1300 + (k % 7) * 120 : 180000 + (k % 9) * 35000;
    const growth = isRent ? 0.002 + (k % 5) * 0.001 : 0.002 + (k % 6) * 0.0015;
    const values = months.map((_, i) => (base * (1 + growth) ** i).toFixed(2));
    lines.push(`${k},${k},${zip},zip,PA,PA,Philadelphia,"Philadelphia-Camden-Wilmington, PA-NJ-DE-MD",Philadelphia County,${values.join(",")}`);
    k++;
  }
  return lines.join("\n") + "\n";
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const send = (code, body, type = "application/json") => {
    res.writeHead(code, { "content-type": type });
    res.end(typeof body === "string" ? body : JSON.stringify(body));
  };
  const p = url.pathname;
  console.log(req.method, p, url.search.slice(0, 90));
  if (p === "/tiger/Tracts_Blocks/MapServer") return send(200, { layers: [{ id: 0, name: "Census Tracts" }, { id: 1, name: "Census Block Groups" }] });
  if (p === "/tiger/Tracts_Blocks/MapServer/0/query") return send(200, tractQuery(envelope(url.searchParams)));
  if (p === "/tiger/PUMA_TAD_TAZ_UGA_ZCTA/MapServer") {
    return send(200, {
      layers: [
        { id: 0, name: "2020 Census Public Use Microdata Areas" },
        { id: 1, name: "2010 Census ZIP Code Tabulation Areas" },
        { id: 2, name: "2020 Census ZIP Code Tabulation Areas" },
      ],
    });
  }
  if (p === "/tiger/PUMA_TAD_TAZ_UGA_ZCTA/MapServer/2/query") return send(200, zctaQuery(envelope(url.searchParams)));
  if (p === "/census/2025/acs/acs5") return send(404, "error: unknown/unsupported geography hierarchy", "text/plain");
  if (/^\/census\/\d{4}\/acs\/acs5$/.test(p)) return send(200, acs(url.searchParams));
  if (p === "/overpass" && req.method === "POST") {
    let data = "";
    req.on("data", (c) => (data += c));
    req.on("end", () => send(200, overpass(decodeURIComponent(new URLSearchParams(data).get("data") || ""))));
    return;
  }
  if (p.startsWith("/zillow/")) {
    if (p.includes("bdrmcnt_5")) return send(404, "Not Found", "text/plain");
    return send(200, zillowCsv(p), "text/csv");
  }
  send(404, { error: "not mocked" });
});

server.listen(PORT, "127.0.0.1", () => console.log(`mock data server on http://127.0.0.1:${PORT} (${tracts.length} tracts)`));
