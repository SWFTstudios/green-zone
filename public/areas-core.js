/* Area metrics catalog, presets and scoring. Pure functions shared by the Explore view and tests. */

export const GROUPS = [
  "Market",
  "Rentals",
  "Housing stock",
  "Economy",
  "Outdoors & lighting",
  "Amenities & transit",
  "Land use",
  "Your drives",
];

const Z = "Zillow";
const ACS = "Census ACS";
const OSM = "OpenStreetMap";

export const LAND_USES = [
  "Residential",
  "Commercial",
  "Retail",
  "Industrial",
  "Under construction",
  "Brownfield (vacant, previously developed)",
  "Greenfield (planned development)",
  "Recreation",
  "Farmland",
  "Open land",
  "Forest",
  "Education",
  "Institutional",
];

/** fmt: usd | usdmo | pct | int | dec | year | rating | text. mode: the default direction. */
export const METRICS = [
  { key: "zhvi", group: "Market", label: "Typical home value", fmt: "usd", source: Z, mode: "range", help: "Zillow Home Value Index for all homes in the area's ZIP code." },
  { key: "zhviSfr", group: "Market", label: "Typical single-family value", fmt: "usd", source: Z, mode: "range" },
  { key: "zhviCondo", group: "Market", label: "Typical condo / co-op value", fmt: "usd", source: Z, mode: "range" },
  { key: "zhvi1br", group: "Market", label: "Typical 1-bedroom value", fmt: "usd", source: Z, mode: "range" },
  { key: "zhvi2br", group: "Market", label: "Typical 2-bedroom value", fmt: "usd", source: Z, mode: "range" },
  { key: "zhvi3br", group: "Market", label: "Typical 3-bedroom value", fmt: "usd", source: Z, mode: "range" },
  { key: "zhvi4br", group: "Market", label: "Typical 4-bedroom value", fmt: "usd", source: Z, mode: "range" },
  { key: "zhvi5br", group: "Market", label: "Typical 5+ bedroom value", fmt: "usd", source: Z, mode: "range" },
  { key: "zhviYoY", group: "Market", label: "Home value change, last 12 months", fmt: "pct", source: Z, mode: "higher" },
  { key: "medianHomeValue", group: "Market", label: "Median home value (owner estimate)", fmt: "usd", source: ACS, mode: "range" },
  { key: "zori", group: "Rentals", label: "Typical asking rent", fmt: "usdmo", source: Z, mode: "higher" },
  { key: "zoriYoY", group: "Rentals", label: "Rent change, last 12 months", fmt: "pct", source: Z, mode: "higher" },
  { key: "grossYield", group: "Rentals", label: "Gross rent yield", fmt: "pct", source: "Zillow or Census", mode: "higher", help: "A year of rent divided by the home value. Uses Zillow when available, otherwise Census medians." },
  { key: "medianRent", group: "Rentals", label: "Median gross rent", fmt: "usdmo", source: ACS, mode: "higher" },
  { key: "renterRate", group: "Rentals", label: "Homes that are rented", fmt: "pct", source: ACS, mode: "higher" },
  { key: "vacancyRate", group: "Housing stock", label: "Vacancy rate", fmt: "pct", source: ACS, mode: "lower" },
  { key: "ownerOccupiedRate", group: "Housing stock", label: "Homes lived in by owners", fmt: "pct", source: ACS, mode: "higher" },
  { key: "medianYearBuilt", group: "Housing stock", label: "Median year built", fmt: "year", source: ACS, mode: "higher" },
  { key: "pctSingleFamily", group: "Housing stock", label: "Single-family homes", fmt: "pct", source: ACS, mode: "higher" },
  { key: "pctSmallMulti", group: "Housing stock", label: "2–4 unit buildings", fmt: "pct", source: ACS, mode: "higher" },
  { key: "pctLargeMulti", group: "Housing stock", label: "5+ unit buildings", fmt: "pct", source: ACS, mode: "higher" },
  { key: "pctMobile", group: "Housing stock", label: "Mobile homes", fmt: "pct", source: ACS, mode: "lower" },
  { key: "housingUnits", group: "Housing stock", label: "Housing units", fmt: "int", source: ACS, mode: "higher" },
  { key: "medianIncome", group: "Economy", label: "Median household income", fmt: "usd", source: ACS, mode: "higher" },
  { key: "unemploymentRate", group: "Economy", label: "Unemployment rate", fmt: "pct", source: ACS, mode: "lower" },
  { key: "population", group: "Economy", label: "Population", fmt: "int", source: ACS, mode: "higher" },
  { key: "popDensity", group: "Economy", label: "People per km²", fmt: "int", source: ACS, mode: "higher" },
  { key: "outdoorPerKm2", group: "Outdoors & lighting", label: "Outdoor activity spots per km²", fmt: "dec", source: OSM, mode: "higher", help: "Parks, playgrounds, sports and fitness spots, plus trails and footpaths. A stand-in for where people run and work out outside." },
  { key: "litPerKm2", group: "Outdoors & lighting", label: "Street lighting per km²", fmt: "dec", source: OSM, mode: "higher", help: "Streets mapped as lit at night, plus individual street lamps." },
  { key: "pathsPerKm2", group: "Outdoors & lighting", label: "Trails, footpaths and bike paths per km²", fmt: "dec", source: OSM, mode: "higher" },
  { key: "parks", group: "Outdoors & lighting", label: "Parks and playgrounds", fmt: "int", source: OSM, mode: "higher" },
  { key: "fitnessPerKm2", group: "Outdoors & lighting", label: "Sports and fitness spots per km²", fmt: "dec", source: OSM, mode: "higher" },
  { key: "transitPerKm2", group: "Amenities & transit", label: "Transit stops per km²", fmt: "dec", source: OSM, mode: "higher" },
  { key: "grocery", group: "Amenities & transit", label: "Grocery stores", fmt: "int", source: OSM, mode: "higher" },
  { key: "schools", group: "Amenities & transit", label: "Schools and libraries", fmt: "int", source: OSM, mode: "higher" },
  { key: "foodPerKm2", group: "Amenities & transit", label: "Restaurants and cafés per km²", fmt: "dec", source: OSM, mode: "higher" },
  { key: "healthcare", group: "Amenities & transit", label: "Clinics, pharmacies and hospitals", fmt: "int", source: OSM, mode: "higher" },
  { key: "landUse", group: "Land use", label: "Main land use (mapped, not legal zoning)", fmt: "text", source: OSM, mode: "oneOf", help: "The most common land use mapped in OpenStreetMap. Check the county's zoning map before buying." },
  { key: "myRating", group: "Your drives", label: "Your drive ratings", fmt: "rating", source: "Your trips", mode: "higher", help: "From streets you painted: +100 if all green, −100 if all red." },
];

const BY_KEY = new Map(METRICS.map((m) => [m.key, m]));
export const metricByKey = (key) => BY_KEY.get(key);

const c = (key, weight, extra = {}) => ({ key, weight, mode: BY_KEY.get(key).mode, ...extra });

export const PRESETS = {
  balanced: {
    label: "Balanced investor",
    criteria: [
      c("grossYield", 4),
      c("zhviYoY", 3),
      c("vacancyRate", 3),
      c("medianIncome", 2),
      c("unemploymentRate", 2),
      c("litPerKm2", 2),
      c("outdoorPerKm2", 2),
      c("myRating", 3),
    ],
  },
  cashflow: {
    label: "Cash-flow rentals",
    criteria: [c("grossYield", 5), c("renterRate", 3), c("vacancyRate", 3), c("zoriYoY", 2), c("unemploymentRate", 2), c("transitPerKm2", 1)],
  },
  appreciation: {
    label: "Appreciation",
    criteria: [c("zhviYoY", 5), c("zoriYoY", 2), c("medianIncome", 3), c("foodPerKm2", 2), c("vacancyRate", 2), c("ownerOccupiedRate", 1)],
  },
  flip: {
    label: "Fix and flip",
    criteria: [
      c("medianYearBuilt", 3, { mode: "lower" }),
      c("zhviYoY", 4),
      c("pctSingleFamily", 3),
      c("zhviSfr", 2, { mode: "lower" }),
      c("vacancyRate", 2),
      c("ownerOccupiedRate", 2),
    ],
  },
  outdoor: {
    label: "Active and well lit",
    criteria: [c("outdoorPerKm2", 5), c("litPerKm2", 5), c("pathsPerKm2", 3), c("parks", 2), c("transitPerKm2", 1), c("vacancyRate", 1)],
  },
  singleFamily: {
    label: "Single-family neighborhoods",
    criteria: [c("pctSingleFamily", 4), c("ownerOccupiedRate", 3), c("parks", 3), c("schools", 2), c("litPerKm2", 2), c("vacancyRate", 2)],
  },
};

export const DEFAULT_SETTINGS = { preset: "balanced", green: 67, red: 34, hideFails: false };

export const IMPORTANCE = ["Ignore", "Minor", "Some", "Important", "Very important", "Critical"];

/* ---------- formatting ---------- */

const usd0 = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

export function formatValue(metric, v) {
  if (v === null || v === undefined || v === "" || (typeof v === "number" && !Number.isFinite(v))) return "—";
  switch (metric?.fmt) {
    case "usd":
      return usd0.format(v);
    case "usdmo":
      return `${usd0.format(v)}/mo`;
    case "pct":
      return `${(v * 100).toFixed(Math.abs(v) < 0.1 ? 1 : 0)}%`;
    case "int":
      return Math.round(v).toLocaleString("en-US");
    case "dec":
      return v >= 10 ? Math.round(v).toLocaleString("en-US") : v.toFixed(1);
    case "year":
      return String(Math.round(v));
    case "rating":
      return `${v > 0 ? "+" : ""}${Math.round(v)}`;
    default:
      return String(v);
  }
}

/** Percent metrics are edited as whole percents (5 = 5%) but stored as fractions. */
export const inputScale = (metric) => (metric?.fmt === "pct" ? 100 : 1);

/* ---------- scoring ---------- */

const finite = (v) => typeof v === "number" && Number.isFinite(v);

function percentile(sorted, v) {
  if (sorted.length <= 1) return 50;
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sorted[mid] < v) lo = mid + 1;
    else hi = mid;
  }
  let eq = lo;
  while (eq < sorted.length && sorted[eq] === v) eq++;
  const rank = lo + (eq - lo - 1) / 2;
  return (rank / (sorted.length - 1)) * 100;
}

export function meetsBounds(crit, v) {
  if (crit.mode === "oneOf") return v != null && (crit.oneOf || []).includes(v);
  if (!finite(v)) return false;
  if (finite(crit.min) && v < crit.min) return false;
  if (finite(crit.max) && v > crit.max) return false;
  return true;
}

/** 0–100 for one criterion, or null when the area has no value for it. */
export function criterionScore(crit, v, sorted) {
  if (crit.mode === "oneOf") {
    if (v == null || !(crit.oneOf || []).length) return null;
    return crit.oneOf.includes(v) ? 100 : 0;
  }
  if (!finite(v)) return null;
  const hasMin = finite(crit.min);
  const hasMax = finite(crit.max);
  if (crit.mode === "range") {
    if (!hasMin && !hasMax) return null;
    if (meetsBounds(crit, v)) return 100;
    const bound = hasMin && v < crit.min ? crit.min : crit.max;
    const width = hasMin && hasMax ? crit.max - crit.min : Math.abs(bound) * 0.5;
    return Math.max(0, 100 * (1 - Math.abs(v - bound) / (width || 1)));
  }
  if ((hasMin || hasMax) && !meetsBounds(crit, v)) return 0;
  const p = percentile(sorted, v);
  return crit.mode === "lower" ? 100 - p : p;
}

/**
 * Scores areas against criteria. Directional criteria are ranked against the other areas
 * passed in (normally the ones on screen); ranges and land use are absolute.
 */
export function scoreAreas(areas, criteria, settings = DEFAULT_SETTINGS) {
  const active = criteria.filter((cr) => cr.weight > 0 || cr.must);
  const sortedByKey = new Map();
  for (const cr of active) {
    if (cr.mode === "oneOf" || sortedByKey.has(cr.key)) continue;
    sortedByKey.set(
      cr.key,
      areas
        .map((a) => a.metrics?.[cr.key])
        .filter(finite)
        .sort((x, y) => x - y),
    );
  }
  const out = new Map();
  for (const a of areas) {
    if (!a.metrics) {
      out.set(a.geoid, { score: null, color: "pending", parts: [], fails: [] });
      continue;
    }
    let total = 0;
    let weights = 0;
    const fails = [];
    const parts = active.map((cr) => {
      const value = a.metrics[cr.key];
      const score = criterionScore(cr, value, sortedByKey.get(cr.key) || []);
      const passes = cr.must ? meetsBounds(cr, value) : null;
      if (cr.must && !passes) fails.push(cr.key);
      if (score !== null && cr.weight > 0) {
        total += score * cr.weight;
        weights += cr.weight;
      }
      return { key: cr.key, value, score, passes };
    });
    const score = weights ? Math.round(total / weights) : null;
    const color = fails.length
      ? "fail"
      : score === null
        ? "nodata"
        : score >= settings.green
          ? "green"
          : score >= settings.red
            ? "yellow"
            : "red";
    out.set(a.geoid, { score, color, parts, fails });
  }
  return out;
}

/* ---------- geometry (client side) ---------- */

function inRing(lng, lat, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export function pointInGeometry(lng, lat, geom) {
  const polys = geom.type === "Polygon" ? [geom.coordinates] : geom.coordinates;
  return polys.some((rings) => rings.length && inRing(lng, lat, rings[0]) && !rings.slice(1).some((h) => inRing(lng, lat, h)));
}

export function geometryBounds(geom) {
  const b = { w: Infinity, s: Infinity, e: -Infinity, n: -Infinity };
  const polys = geom.type === "Polygon" ? [geom.coordinates] : geom.coordinates;
  for (const rings of polys) {
    for (const [lng, lat] of rings[0] || []) {
      b.w = Math.min(b.w, lng);
      b.e = Math.max(b.e, lng);
      b.s = Math.min(b.s, lat);
      b.n = Math.max(b.n, lat);
    }
  }
  return b;
}

function haversine(a, b) {
  const R = 6371000;
  const rad = (d) => (d * Math.PI) / 180;
  const dLat = rad(b[0] - a[0]);
  const dLng = rad(b[1] - a[1]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[0])) * Math.cos(rad(b[0])) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/**
 * Turns painted segments into a −100…+100 rating per area. `weights` maps a zone id to
 * +1 (good), 0 (caution) or −1 (bad). Segment paths are [lat, lng] like the rest of the app.
 */
export function driveRatings(areas, segments, weights) {
  const sums = new Map();
  for (const seg of segments) {
    const w = weights.get(seg.zoneTypeId);
    if (w === undefined) continue;
    for (let i = 1; i < seg.path.length; i++) {
      const a = seg.path[i - 1];
      const b = seg.path[i];
      const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
      const area = areas.find(
        (x) => mid[1] >= x.bounds.w && mid[1] <= x.bounds.e && mid[0] >= x.bounds.s && mid[0] <= x.bounds.n && pointInGeometry(mid[1], mid[0], x.geometry),
      );
      if (!area) continue;
      const m = haversine(a, b);
      const s = sums.get(area.geoid) || { weighted: 0, total: 0 };
      s.weighted += w * m;
      s.total += m;
      sums.set(area.geoid, s);
    }
  }
  const out = new Map();
  for (const [geoid, s] of sums) if (s.total > 30) out.set(geoid, { rating: Math.round((100 * s.weighted) / s.total), meters: s.total });
  return out;
}
