/* Area metrics catalog, presets and scoring. Pure functions shared by the Explore view and tests. */

export const GROUPS = [
  "Market",
  "Rentals",
  "Housing stock",
  "Economy",
  "Outdoors & lighting",
  "Amenities & transit",
  "Risk",
  "Land use",
  "Your drives",
];

const Z = "Zillow";
const ACS = "Census ACS";
const OSM = "OpenStreetMap";
const CDC = "CDC PLACES";
const NASA = "NASA Black Marble";
const FEMA = "FEMA flood maps";
const FRED = "Zillow or Census, FRED rate";

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
  { key: "mortgagePayment", group: "Rentals", label: "Monthly mortgage payment", fmt: "usdmo", source: FRED, mode: "lower", help: "Principal and interest on the typical home value with 20% down, at this week's 30-year fixed rate. Taxes and insurance not included." },
  { key: "rentCoverage", group: "Rentals", label: "Rent ÷ mortgage payment", fmt: "pct", source: FRED, mode: "higher", help: "Typical rent as a share of that mortgage payment. Above 100% means rent covers principal and interest." },
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
  { key: "walkBikeRate", group: "Outdoors & lighting", label: "Commuters who walk or bike", fmt: "pct", source: ACS, mode: "higher", help: "Share of people traveling to work on foot or by bike. A sign of streets people are comfortable walking." },
  { key: "transitRate", group: "Amenities & transit", label: "Commuters who take transit", fmt: "pct", source: ACS, mode: "higher" },
  { key: "workFromHomeRate", group: "Economy", label: "Residents who work from home", fmt: "pct", source: ACS, mode: "higher" },
  { key: "activeAdults", group: "Outdoors & lighting", label: "Adults active in their free time", fmt: "pct", source: CDC, mode: "higher", help: "Share of adults who exercise outside of work (CDC estimate from health surveys). The closest free stand-in for where people run and work out." },
  { key: "nightLight", group: "Outdoors & lighting", label: "Night brightness (satellite)", fmt: "dec", source: NASA, mode: "higher", help: "How bright the area looks from space at night, 0 (dark) to 100 (brightest). NASA Black Marble 2016 composite." },
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
  { key: "floodShare", group: "Risk", label: "Land in a FEMA flood zone", fmt: "pct", source: FEMA, mode: "lower", help: "Share of the area inside FEMA's 1%-a-year (100-year) floodplain, where lenders usually require flood insurance. 0% can also mean FEMA hasn't mapped the area digitally yet." },
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
      c("activeAdults", 2),
      c("floodShare", 2),
      c("myRating", 3),
    ],
  },
  cashflow: {
    label: "Cash-flow rentals",
    criteria: [c("grossYield", 5), c("rentCoverage", 4), c("renterRate", 3), c("vacancyRate", 3), c("zoriYoY", 2), c("unemploymentRate", 2), c("transitPerKm2", 1)],
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
    criteria: [
      c("activeAdults", 5),
      c("walkBikeRate", 4),
      c("nightLight", 4),
      c("outdoorPerKm2", 3),
      c("litPerKm2", 3),
      c("parks", 2),
      c("vacancyRate", 1),
    ],
  },
  singleFamily: {
    label: "Single-family neighborhoods",
    criteria: [c("pctSingleFamily", 4), c("ownerOccupiedRate", 3), c("parks", 3), c("schools", 2), c("litPerKm2", 2), c("vacancyRate", 2)],
  },
};

export const DEFAULT_SETTINGS = { preset: "balanced", green: 67, red: 34, hideFails: false };

export const IMPORTANCE = ["Ignore", "Minor", "Some", "Important", "Very important", "Critical"];

/* ---------- map overlays ---------- */

/**
 * Ways to color areas on the map. "score" uses the user's criteria; the rest are single measures,
 * stretched between the 5th and 95th percentile on screen unless they set a fixed `domain`.
 */
export const OVERLAYS = [
  { id: "score", label: "Your criteria", short: "Score", help: "Green, yellow and red from the criteria in Explore." },
  { id: "activeAdults", label: "Active adults", short: "Active", metric: "activeAdults", source: CDC, ramp: ["#fff7bc", "#c2e699", "#78c679", "#31a354", "#006837"] },
  { id: "walkBikeRate", label: "Walk & bike commuters", short: "Walk/bike", metric: "walkBikeRate", source: ACS, ramp: ["#f1eef6", "#bdc9e1", "#74a9cf", "#2b8cbe", "#045a8d"] },
  { id: "nightLight", label: "Night brightness", short: "Night", metric: "nightLight", source: NASA, ramp: ["#000004", "#3b0f70", "#8c2981", "#de4968", "#fe9f6d", "#fcfdbf"] },
  { id: "floodShare", label: "Flood risk", short: "Flood", metric: "floodShare", source: FEMA, domain: [0, 0.5], ramp: ["#f7fbff", "#c6dbef", "#6baed6", "#2171b5", "#08306b"] },
  { id: "rentCoverage", label: "Rent vs. mortgage", short: "Rent/mortgage", metric: "rentCoverage", source: "Zillow + FRED", domain: [0.5, 1.5], ramp: ["#d73027", "#fc8d59", "#fee08b", "#91cf60", "#1a9850"] },
  { id: "transitRate", label: "Transit commuters", short: "Transit", metric: "transitRate", source: ACS, ramp: ["#f2f0f7", "#cbc9e2", "#9e9ac8", "#756bb1", "#54278f"] },
  { id: "off", label: "Off", short: "Off" },
];
export const overlayById = (id) => OVERLAYS.find((o) => o.id === id) || OVERLAYS[0];

function hex(c) {
  const n = parseInt(c.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Color at t (0–1) along a list of hex stops. */
export function rampColor(ramp, t) {
  const x = Math.min(1, Math.max(0, Number.isFinite(t) ? t : 0)) * (ramp.length - 1);
  const i = Math.min(ramp.length - 2, Math.floor(x));
  const a = hex(ramp[i]);
  const b = hex(ramp[i + 1]);
  const f = x - i;
  return `#${a.map((v, k) => Math.round(v + (b[k] - v) * f).toString(16).padStart(2, "0")).join("")}`;
}

function quantile(sorted, q) {
  if (!sorted.length) return null;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  return sorted[lo] + (sorted[Math.min(sorted.length - 1, lo + 1)] - sorted[lo]) * (pos - lo);
}

/**
 * Colors areas by one measure. The scale runs from the 5th to the 95th percentile of the
 * areas passed in (usually those on screen), so neighborhoods stand out from each other.
 */
export function overlayColors(areas, overlay) {
  const values = areas.map((a) => a.metrics?.[overlay.metric]).filter(finite).sort((x, y) => x - y);
  // A fixed domain keeps meaning where it matters (0% flood is always pale, 100% rent coverage is the midpoint).
  const [min, max] = overlay.domain || [quantile(values, 0.05), quantile(values, 0.95)];
  const colors = new Map();
  for (const a of areas) {
    const v = a.metrics?.[overlay.metric];
    if (!finite(v)) continue;
    colors.set(a.geoid, rampColor(overlay.ramp, max > min ? (v - min) / (max - min) : 0.5));
  }
  return { colors, min, max, count: values.length };
}

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
