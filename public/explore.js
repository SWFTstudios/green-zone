/* Explore: score census tracts against the user's criteria and color them on the map. */
import {
  DEFAULT_SETTINGS,
  GROUPS,
  IMPORTANCE,
  LAND_USES,
  METRICS,
  OVERLAYS,
  PRESETS,
  driveRatings,
  formatValue,
  geometryBounds,
  inputScale,
  metricByKey,
  overlayById,
  overlayColors,
  scoreAreas,
} from "./areas-core.js";
import { BASE_STYLES } from "./gzmap.js";

const COLORS = { green: "#16a34a", yellow: "#eab308", red: "#dc2626", fail: "#7f1d1d", nodata: "#94a3b8", pending: "#94a3b8" };
const COLOR_LABELS = { green: "Green", yellow: "Yellow", red: "Red", fail: "Misses a must-have", nodata: "Not enough data", pending: "Loading" };
const PREFS_KEY = "gz_explore_v1";
const DEFAULT_NIGHT_TILES =
  "https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/VIIRS_Black_Marble/default/2016-01-01/GoogleMapsCompatible_Level8/{z}/{y}/{x}.png";
const EMPTY = { type: "FeatureCollection", features: [] };
const MIN_ZOOM = 12;
const MAX_POLLS = 30;

const clone = (v) => JSON.parse(JSON.stringify(v));

const SOURCE_NAMES = {
  census: "Census",
  osm: "OpenStreetMap",
  zip: "ZIP codes",
  cdc: "CDC activity",
  night: "NASA night lights",
  flood: "FEMA flood zones",
};

function loadPrefs() {
  try {
    const p = JSON.parse(localStorage.getItem(PREFS_KEY) || "null");
    if (p && Array.isArray(p.criteria)) {
      return {
        criteria: p.criteria.filter((c) => metricByKey(c.key)),
        settings: { ...DEFAULT_SETTINGS, ...(p.settings || {}) },
        mode: overlayById(p.mode || "score").id,
        everywhere: p.everywhere ?? !!p.overlay,
        night: !!p.night,
        flood: !!p.flood,
        opacity: Number.isFinite(p.opacity) ? p.opacity : 0.45,
      };
    }
  } catch {
    /* storage blocked or corrupt: start from defaults */
  }
  return { criteria: clone(PRESETS.balanced.criteria), settings: { ...DEFAULT_SETTINGS }, mode: "score", everywhere: false, night: false, flood: false, opacity: 0.45 };
}

export function createExplore({ map, api, esc, toast, openUpgrade, getZones, getLastFix, getPadding }) {
  const $ = (sel) => document.querySelector(sel);
  const hovered = { id: null };
  const tip = new map.maplibregl.Popup({ closeButton: false, closeOnClick: false, className: "gz-tip", offset: 12 });

  const areaLayer = map.source(
    "areas",
    { type: "geojson", data: EMPTY, promoteId: "geoid" },
    [
      {
        id: "areas-fill",
        type: "fill",
        paint: {
          "fill-color": ["get", "color"],
          "fill-opacity": ["case", ["boolean", ["feature-state", "hover"], false], ["min", 0.9, ["+", ["get", "op"], 0.18]], ["get", "op"]],
        },
      },
      {
        id: "areas-line",
        type: "line",
        filter: ["!=", ["get", "dashed"], true],
        paint: {
          "line-color": ["case", ["boolean", ["feature-state", "selected"], false], "#0f172a", ["get", "stroke"]],
          "line-width": [
            "case",
            ["boolean", ["feature-state", "selected"], false],
            3.5,
            ["boolean", ["feature-state", "hover"], false],
            2.5,
            0.8,
          ],
          "line-opacity": ["get", "lop"],
        },
      },
      {
        id: "areas-line-dashed",
        type: "line",
        filter: ["==", ["get", "dashed"], true],
        paint: { "line-color": ["get", "stroke"], "line-width": 1.6, "line-dasharray": [2, 2], "line-opacity": ["get", "lop"] },
      },
    ],
    { z: 20 },
  );
  areaLayer.setVisible(false);
  let nightLayer = null;
  let floodLayer = null;

  const prefs = loadPrefs();
  let { criteria, settings } = prefs;
  const areas = new Map();
  let results = new Map();
  let context = null;
  let selected = null;
  let search = null;
  let searches = [];
  let searchLimit = 5;
  let status = { pending: 0, notices: [], message: "" };
  let requestSeq = 0;
  let polls = 0;
  let moveTimer = null;
  let rescoreTimer = null;
  let segments = null;
  let ratings = new Map();
  let dataStatus = null;

  const savePrefs = () => {
    try {
      localStorage.setItem(
        PREFS_KEY,
        JSON.stringify({ criteria, settings, mode: prefs.mode, everywhere: prefs.everywhere, night: prefs.night, flood: prefs.flood, opacity: prefs.opacity }),
      );
    } catch {
      /* not critical */
    }
  };

  /* ---------- data ---------- */

  function boundsBox() {
    const b = map.getBounds();
    return { w: b.getWest(), s: b.getSouth(), e: b.getEast(), n: b.getNorth() };
  }

  const intersects = (a, b) => a.w <= b.e && a.e >= b.w && a.s <= b.n && a.n >= b.s;

  function visibleAreas() {
    const view = boundsBox();
    return [...areas.values()].filter((a) => a.bounds && intersects(a.bounds, view));
  }

  async function ensureSegments() {
    if (segments) return;
    try {
      segments = (await api("/api/map")).segments || [];
    } catch {
      segments = [];
    }
  }

  function ratingWeights() {
    const defaults = getZones().filter((z) => z.isDefault);
    const weights = new Map();
    defaults.forEach((z, i) => weights.set(z.id, i === 0 ? 1 : i === 1 ? 0 : -1));
    return weights;
  }

  function recomputeRatings() {
    if (!segments?.length) return;
    ratings = driveRatings([...areas.values()].filter((a) => a.geometry), segments, ratingWeights());
    for (const a of areas.values()) if (a.metrics) a.metrics.myRating = ratings.get(a.geoid)?.rating ?? null;
  }

  async function load(fresh = true) {
    if (!context || prefs.mode === "off") return;
    if (map.getZoom() < MIN_ZOOM) {
      status = { pending: 0, notices: [], message: "Zoom in to a city or neighborhood to see area scores." };
      renderStatus();
      return;
    }
    const seq = ++requestSeq;
    if (fresh) polls = 0;
    const view = boundsBox();
    const bbox = [view.w, view.s, view.e, view.n].map((v) => v.toFixed(4)).join(",");
    const have = [...areas.values()].filter((a) => a.geometry && intersects(a.bounds, view)).map((a) => a.geoid);
    if (fresh) {
      status = { ...status, message: "Loading area data…" };
      renderStatus();
    }
    try {
      const [data] = await Promise.all([api("/api/areas", { method: "POST", body: { bbox, have } }), ensureSegments()]);
      if (seq !== requestSeq) return;
      if (data.tooLarge) {
        status = { pending: 0, notices: [], message: "Zoom in a little more to load area data." };
        renderStatus();
        return;
      }
      let newShapes = false;
      for (const item of data.areas) {
        const a = areas.get(item.geoid) || { geoid: item.geoid };
        a.name = item.name;
        if (item.geometry) {
          a.geometry = item.geometry;
          a.bounds = geometryBounds(item.geometry);
          newShapes = true;
        }
        a.metrics = item.metrics ? { ...item.metrics, myRating: null } : null;
        areas.set(a.geoid, a);
      }
      if (newShapes || segments?.length) recomputeRatings();
      status = { pending: data.pending, notices: data.notices || [], message: "" };
      rescore();
      if (data.pending > 0 && polls++ < MAX_POLLS) setTimeout(() => seq === requestSeq && load(false), 1500);
    } catch (err) {
      if (seq !== requestSeq) return;
      status = { pending: 0, notices: [], message: err.message };
      renderStatus();
    }
  }

  map.on("moveend", () => {
    if (!context) return;
    clearTimeout(moveTimer);
    moveTimer = setTimeout(() => {
      load();
      rescore();
    }, context === "passive" ? 1200 : 400);
  });

  /* ---------- map layer ---------- */

  let legend = null;

  /** Rebuilds the tract layer's colors for the current mode (score or a single measure). */
  function paint() {
    const overlay = overlayById(prefs.mode);
    const visible = visibleAreas();
    const ramp = overlay.metric ? overlayColors(visible, overlay) : null;
    legend = ramp ? { overlay, min: ramp.min, max: ramp.max, count: ramp.count } : overlay.id === "score" ? { overlay } : null;
    const base = context === "passive" ? prefs.opacity * 0.6 : prefs.opacity;
    const features = [];
    for (const a of areas.values()) {
      if (!a.geometry) continue;
      let color;
      let op = base;
      let dashed = false;
      let lop = 0.85;
      if (ramp) {
        color = ramp.colors.get(a.geoid);
        if (!color) {
          color = COLORS.nodata;
          op = 0.06;
        }
      } else {
        const r = results.get(a.geoid);
        const c = r?.color || "pending";
        color = COLORS[c];
        if (c === "pending" || c === "nodata") op = 0.06;
        if (c === "fail") {
          dashed = true;
          if (settings.hideFails) op = lop = 0;
        }
      }
      features.push({
        type: "Feature",
        properties: { geoid: a.geoid, color, stroke: color, op, lop, dashed },
        geometry: a.geometry,
      });
    }
    areaLayer.setData({ type: "FeatureCollection", features });
    if (selected) areaLayer.setFeatureState(selected, { selected: true });
    renderLegend();
  }

  function renderLegend() {
    const el = $("#map-legend");
    if (!el) return;
    if (!context || !legend) {
      el.hidden = true;
      return;
    }
    const { overlay } = legend;
    if (overlay.id === "score") {
      el.innerHTML = `<div class="legend-title">Your criteria</div>
        <div class="legend-keys">${["green", "yellow", "red"]
          .map((k) => `<span><i style="background:${COLORS[k]}"></i>${COLOR_LABELS[k]}</span>`)
          .join("")}</div>`;
    } else {
      const metric = metricByKey(overlay.metric);
      el.innerHTML = `<div class="legend-title">${esc(overlay.label)} <span class="muted">· ${esc(overlay.source)}</span></div>
        <div class="legend-ramp" style="background:linear-gradient(90deg,${overlay.ramp.join(",")})"></div>
        <div class="legend-scale"><span>${legend.count ? esc(formatValue(metric, legend.min)) : "—"}</span><span>${legend.count ? esc(formatValue(metric, legend.max)) : "—"}</span></div>`;
    }
    el.hidden = false;
  }

  function tooltipHtml(a) {
    const overlay = overlayById(prefs.mode);
    let detail = "";
    if (overlay.metric) {
      detail = `${esc(overlay.short)}: <b>${esc(formatValue(metricByKey(overlay.metric), a.metrics?.[overlay.metric]))}</b>`;
    } else {
      const r = results.get(a.geoid);
      detail = r?.score != null ? `Score <b>${r.score}</b>` : esc(COLOR_LABELS[r?.color || "pending"]);
    }
    const where = [a.metrics?.zip, a.metrics?.city].filter(Boolean).map(esc).join(" · ");
    return `<div class="tip-name">${esc(a.name)}</div><div>${detail}</div>${where ? `<div class="muted">${where}</div>` : ""}`;
  }

  const raw = map.raw;
  raw.on("mousemove", "areas-fill", (e) => {
    const id = e.features?.[0]?.properties?.geoid;
    if (!id || !context) return;
    if (hovered.id !== id) {
      if (hovered.id) areaLayer.setFeatureState(hovered.id, { hover: false });
      hovered.id = id;
      areaLayer.setFeatureState(id, { hover: true });
    }
    raw.getCanvas().style.cursor = "pointer";
    const a = areas.get(id);
    if (a && matchMedia("(hover: hover)").matches) tip.setLngLat(e.lngLat).setHTML(tooltipHtml(a)).addTo(raw);
  });
  raw.on("mouseleave", "areas-fill", () => {
    if (hovered.id) areaLayer.setFeatureState(hovered.id, { hover: false });
    hovered.id = null;
    raw.getCanvas().style.cursor = "";
    tip.remove();
  });
  raw.on("click", "areas-fill", (e) => {
    const id = e.features?.[0]?.properties?.geoid;
    const a = id && areas.get(id);
    if (!a || !context) return;
    if (context === "explore") return openArea(id);
    if (document.body.classList.contains("drive-active") && document.querySelector("#draw-btn")?.getAttribute("aria-pressed") === "true") return;
    new map.maplibregl.Popup({ maxWidth: "260px", className: "gz-card" })
      .setLngLat(e.lngLat)
      .setHTML(`${tooltipHtml(a)}<a class="tip-link" href="#/explore">Open in Explore</a>`)
      .addTo(raw);
  });

  function ensureNight() {
    if (nightLayer || !prefs.night) return;
    const tiles = dataStatus?.nightLights?.url || DEFAULT_NIGHT_TILES;
    nightLayer = map.source(
      "night-lights",
      { type: "raster", tiles: [tiles], tileSize: 256, maxzoom: dataStatus?.nightLights?.zoom || 8, attribution: "Night lights: NASA Black Marble (GIBS)" },
      [{ id: "night-lights", type: "raster", paint: { "raster-opacity": 0.85, "raster-fade-duration": 200 } }],
      { z: 10 },
    );
  }

  function ensureFlood() {
    // The tile URL comes from the server, so wait for the data status.
    if (floodLayer || !prefs.flood || !dataStatus?.floodTiles) return;
    floodLayer = map.source(
      "flood-zones",
      { type: "raster", tiles: [dataStatus.floodTiles], tileSize: 256, minzoom: 11, attribution: "Flood zones: FEMA NFHL" },
      [{ id: "flood-zones", type: "raster", paint: { "raster-opacity": 0.6, "raster-fade-duration": 200 } }],
      { z: 12 },
    );
  }

  function applyLayers() {
    const showAreas = !!context && prefs.mode !== "off";
    areaLayer.setVisible(showAreas);
    ensureNight();
    nightLayer?.setVisible(prefs.night && mapContext !== null);
    ensureFlood();
    floodLayer?.setVisible(prefs.flood && mapContext !== null);
    if (showAreas) paint();
    else renderLegend();
    if (!showAreas) tip.remove();
  }

  function rescore() {
    results = scoreAreas(visibleAreas(), criteria, settings);
    paint();
    renderStatus();
    renderSummary();
    if (selected && context === "explore") renderArea();
  }

  function rescoreSoon() {
    clearTimeout(rescoreTimer);
    rescoreTimer = setTimeout(rescore, 120);
  }

  /* ---------- panel ---------- */

  const body = () => $("#panel-body");

  function countColors(list) {
    const counts = { green: 0, yellow: 0, red: 0, fail: 0, nodata: 0, pending: 0 };
    for (const a of list) counts[results.get(a.geoid)?.color || "pending"]++;
    return counts;
  }

  function fmtCounts(counts) {
    return ["green", "yellow", "red"].map((k) => `${counts[k] || 0} ${k}`).join(" · ");
  }

  function renderPanel() {
    if (context !== "explore") return;
    if (selected) return renderArea();
    const presetOptions = Object.entries(PRESETS)
      .map(([id, p]) => `<option value="${id}" ${settings.preset === id ? "selected" : ""}>${esc(p.label)}</option>`)
      .join("");
    body().innerHTML = `
      <h2>Explore areas</h2>
      <p class="muted small">Neighborhoods (Census tracts) colored by your criteria. Tap an area for its numbers.</p>
      <form class="ex-find" id="ex-find">
        <input id="ex-place" type="search" placeholder="Find a city, ZIP or address" aria-label="Find a place" autocomplete="off">
        <button class="btn btn-ghost" type="submit">Go</button>
        <button class="btn btn-ghost" type="button" id="ex-locate" title="Go to my location">◎</button>
        <div class="ex-suggest" id="ex-suggest" role="listbox" hidden></div>
      </form>
      <p class="stat-line" id="ex-status"></p>
      <div class="ex-counts" id="ex-counts"></div>
      <div id="ex-saved">${savedSection()}</div>
      <label for="ex-preset">Start from a preset</label>
      <select id="ex-preset">${presetOptions}<option value="custom" ${settings.preset === "custom" ? "selected" : ""}>Custom</option></select>
      <h3>Your criteria</h3>
      <p class="muted small">Each area gets 0–100. "Higher" and "lower" compare areas on screen; ranges and must-haves are exact.</p>
      <div id="ex-criteria" class="crit-list">${criteria.map(critCard).join("")}</div>
      <label for="ex-add">Add a criterion</label>
      <select id="ex-add">${addOptions()}</select>
      <h3>Colors</h3>
      <div class="ex-thresholds">
        <label>Green at <input type="number" id="ex-green" min="2" max="100" value="${settings.green}"> and up</label>
        <label>Red below <input type="number" id="ex-red" min="1" max="99" value="${settings.red}"></label>
      </div>
      <label class="check"><input type="checkbox" id="ex-hide" ${settings.hideFails ? "checked" : ""}> Hide areas that miss a must-have</label>
      <h3>Best matches on screen</h3>
      <ol class="ex-top" id="ex-top"></ol>
      <details class="ex-about"><summary>About this data</summary><div id="ex-about">${aboutHtml()}</div></details>`;
    renderStatus();
    renderSummary();
  }

  function savedSection() {
    const options = searches
      .map((s) => `<option value="${esc(s.id)}" ${search?.id === s.id ? "selected" : ""}>${esc(s.name)}</option>`)
      .join("");
    let banner = "";
    if (search) {
      const snap = search.results || {};
      const saved = new Date(search.updatedAt).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
      const items = (snap.areas || [])
        .slice(0, 12)
        .map(
          (a) => `<li><button type="button" data-goto="${a.lat},${a.lng}" data-geoid="${esc(a.geoid)}">
            <span class="sw" style="background:${COLORS[a.color] || COLORS.nodata}"></span>${esc(a.name)}
            <span class="muted small">${a.score ?? "—"}${a.zip ? ` · ${esc(a.zip)}` : ""}</span></button></li>`,
        )
        .join("");
      banner = `<div class="ex-search">
        <div class="ex-search-title"><b>${esc(search.name)}</b><span class="muted small">Saved ${esc(saved)}${snap.counts ? ` · ${fmtCounts(snap.counts)}` : ""}</span></div>
        ${items ? `<details><summary>Results when saved</summary><ol class="ex-top">${items}</ol></details>` : ""}
        <div class="row-actions">
          <button class="btn btn-primary" type="button" id="ex-update">Save changes</button>
          <button class="btn btn-ghost" type="button" id="ex-rename">Rename</button>
          <button class="btn btn-ghost" type="button" id="ex-close">Close</button>
          <button class="btn btn-danger-ghost" type="button" id="ex-delete">Delete</button>
        </div>
      </div>`;
    }
    return `${banner}
      <div class="ex-saved-row">
        <select id="ex-searches" aria-label="Saved searches"><option value="">Saved searches (${searches.length}/${searchLimit})</option>${options}</select>
        <button class="btn btn-ghost" type="button" id="ex-save">${search ? "Save as new" : "Save search"}</button>
      </div>`;
  }

  function addOptions() {
    const used = new Set(criteria.map((c) => c.key));
    return `<option value="">Choose…</option>${GROUPS.map((g) => {
      const opts = METRICS.filter((m) => m.group === g && !used.has(m.key))
        .map((m) => `<option value="${m.key}">${esc(m.label)}</option>`)
        .join("");
      return opts ? `<optgroup label="${esc(g)}">${opts}</optgroup>` : "";
    }).join("")}`;
  }

  function critCard(cr, i) {
    const m = metricByKey(cr.key);
    const scale = inputScale(m);
    const unit = m.fmt === "pct" ? " %" : m.fmt.startsWith("usd") ? " $" : "";
    const bound = (v) => (Number.isFinite(v) ? String(+(v * scale).toFixed(4)) : "");
    const controls =
      cr.mode === "oneOf"
        ? `<div class="crit-oneof">${LAND_USES.map(
            (lu) => `<label class="check"><input type="checkbox" data-oneof="${esc(lu)}" ${(cr.oneOf || []).includes(lu) ? "checked" : ""}> ${esc(lu)}</label>`,
          ).join("")}</div>`
        : `<select data-field="mode" aria-label="Direction">
            <option value="higher" ${cr.mode === "higher" ? "selected" : ""}>Higher is better</option>
            <option value="lower" ${cr.mode === "lower" ? "selected" : ""}>Lower is better</option>
            <option value="range" ${cr.mode === "range" ? "selected" : ""}>Within a range</option>
          </select>
          <input type="number" step="any" data-field="min" placeholder="Min${unit}" value="${bound(cr.min)}" aria-label="Minimum">
          <input type="number" step="any" data-field="max" placeholder="Max${unit}" value="${bound(cr.max)}" aria-label="Maximum">`;
    return `<div class="crit" data-i="${i}">
      <div class="crit-head">
        <span class="crit-title">${esc(m.label)}</span>
        <span class="muted small">${esc(m.source)}</span>
        <button type="button" class="crit-remove" data-remove="${i}" aria-label="Remove ${esc(m.label)}">×</button>
      </div>
      ${m.help ? `<p class="muted small crit-help">${esc(m.help)}</p>` : ""}
      <label class="crit-weight">Importance
        <input type="range" min="0" max="5" step="1" data-field="weight" value="${cr.weight}">
        <span data-weight-label>${IMPORTANCE[cr.weight]}</span>
      </label>
      <div class="crit-row">${controls}
        <label class="check crit-must"><input type="checkbox" data-field="must" ${cr.must ? "checked" : ""}> Must have</label>
      </div>
    </div>`;
  }

  function renderStatus() {
    const el = $("#ex-status");
    if (!el) return;
    const visible = visibleAreas();
    const ready = visible.filter((a) => a.metrics).length;
    const parts = [];
    if (status.message) parts.push(esc(status.message));
    else if (visible.length) parts.push(`${ready} of ${visible.length} areas on screen ready`);
    if (status.pending > 0) parts.push(`loading ${status.pending} more…`);
    el.innerHTML =
      parts.join(" · ") +
      status.notices.map((n) => `<span class="ex-notice">Some data is temporarily unavailable: ${esc(n)}</span>`).join("");
  }

  function renderSummary() {
    if (context !== "explore") return;
    const visible = visibleAreas();
    const counts = countColors(visible);
    const chips = $("#ex-counts");
    if (chips) {
      chips.innerHTML = ["green", "yellow", "red", "fail", "nodata"]
        .filter((k) => counts[k] || ["green", "yellow", "red"].includes(k))
        .map((k) => `<span class="chip"><span class="sw" style="background:${COLORS[k]}"></span>${counts[k]} ${esc(COLOR_LABELS[k].toLowerCase())}</span>`)
        .join("");
    }
    const top = $("#ex-top");
    if (top) {
      const best = visible
        .map((a) => ({ a, r: results.get(a.geoid) }))
        .filter((x) => x.r?.score != null && x.r.color !== "fail")
        .sort((x, y) => y.r.score - x.r.score)
        .slice(0, 8);
      top.innerHTML = best.length
        ? best
            .map(
              ({ a, r }) => `<li><button type="button" data-area="${esc(a.geoid)}">
                <span class="sw" style="background:${COLORS[r.color]}"></span>${esc(a.name)}
                <span class="muted small">${r.score}${a.metrics?.zip ? ` · ${esc(a.metrics.zip)}` : ""}${a.metrics?.city ? ` · ${esc(a.metrics.city)}` : ""}</span></button></li>`,
            )
            .join("")
        : `<li class="muted small">Scores appear once area data loads.</li>`;
    }
  }

  function aboutHtml() {
    const zillow = dataStatus?.zillow || [];
    const loaded = zillow.filter((d) => d.importedAt);
    const failed = zillow.filter((d) => d.error && !d.importedAt);
    const rate = dataStatus?.mortgageRate;
    const canLoad = dataStatus?.canLoadMarket && loaded.length < zillow.length;
    return `
      <p><b>Home values and rents</b> come from Zillow Research (ZHVI and ZORI) by ZIP code${
        loaded.length ? `, latest month ${esc(loaded.map((d) => d.month).filter(Boolean).sort().pop() || "")}` : ""
      }. ${loaded.length ? `${loaded.length} of ${zillow.length} Zillow datasets loaded.` : "Zillow data hasn't been imported yet, so Census figures are used instead."}${
        failed.length ? ` <span class="ex-notice">Import problem: ${esc(failed[0].label)}: ${esc(failed[0].error)}</span>` : ""
      }</p>
      ${canLoad ? `<p><button class="btn btn-ghost" type="button" data-market-load>Load Zillow data now</button> <span class="muted small" id="market-load-status">Takes a minute or two.</span></p>` : ""}
      <p><b>Mortgage payments</b> use Freddie Mac's 30-year fixed rate from FRED${rate?.rate ? ` (${esc(rate.rate)}% on ${esc(rate.date)})` : ""}, with 20% down, before taxes and insurance.</p>
      <p><b>Housing, economy and commuting</b> come from the Census American Community Survey 5-year estimates for each tract. Only housing, market, commuting and economic figures are used. Nothing about race, ethnicity, religion, sex, family status or disability goes into a score.</p>
      <p><b>Flood zones</b> come from FEMA's National Flood Hazard Layer: the share of each tract in a 1%-a-year (100-year) flood zone, where lenders usually require flood insurance.</p>
      <p><b>Active adults</b> come from CDC PLACES, a model-based estimate of adults who got physical activity outside work in the past month. <b>Night brightness</b> comes from NASA Black Marble satellite imagery; in dense city centers it tops out, so street lighting from OpenStreetMap tells those areas apart better.</p>
      <p><b>Outdoors, lighting, amenities and land use</b> come from OpenStreetMap. That data is crowd-mapped, so coverage varies by city.</p>
      <p><b>Zoning:</b> there's no free nationwide zoning dataset. "Main land use" is what's mapped on the ground, not the legal zoning. Check the city or county zoning map before you buy.</p>
      <p><b>Crime</b> isn't included; there's no reliable nationwide source by neighborhood. Your own drive ratings can stand in for what you see.</p>
      <p class="muted small">Home value and rent data © Zillow, Inc., Zillow Research. Map data © OpenStreetMap contributors. Census Bureau, CDC, FEMA, NASA and Federal Reserve Bank of St. Louis (FRED) data.${dataStatus?.rentcast ? " Market snapshots by RentCast." : ""}</p>`;
  }

  function renderArea() {
    const a = areas.get(selected);
    if (!a) {
      selected = null;
      return renderPanel();
    }
    const r = results.get(a.geoid) || { score: null, color: "pending", parts: [], fails: [] };
    const m = a.metrics || {};
    const where = [m.zip && `ZIP ${m.zip}`, m.city, m.metro].filter(Boolean).map(esc).join(" · ");
    const parts = r.parts
      .map((p) => {
        const metric = metricByKey(p.key);
        const mark = p.passes === false ? `<span class="fail-mark">✕ must-have</span>` : p.passes ? `<span class="ok-mark">✓</span>` : "";
        return `<li><span class="part-label">${esc(metric.label)} ${mark}</span>
          <span class="part-value">${esc(formatValue(metric, p.value))}</span>
          <span class="bar"><i style="width:${p.score ?? 0}%"></i></span></li>`;
      })
      .join("");
    const groups = GROUPS.map((g) => {
      const rows = METRICS.filter((x) => x.group === g)
        .map((x) => `<tr><th>${esc(x.label)}</th><td>${esc(formatValue(x, m[x.key]))}</td></tr>`)
        .join("");
      return `<h3>${esc(g)}</h3><table class="area-table">${rows}</table>`;
    }).join("");
    const mix = m.landUseMix
      ? `<p class="muted small">Mapped land use: ${Object.entries(m.landUseMix)
          .sort((x, y) => y[1] - x[1])
          .map(([k, v]) => `${esc(k)} (${v})`)
          .join(", ")}</p>`
      : "";
    const missing = (m.missing || []).length
      ? `<p class="ex-notice">Still loading: ${esc(m.missing.map((k) => SOURCE_NAMES[k] || k).join(", "))}. It will retry automatically.</p>`
      : "";
    const rate = dataStatus?.mortgageRate;
    body().innerHTML = `
      <button class="btn btn-link ex-back" type="button" id="ex-back">← Back to results</button>
      <h2>${esc(a.name)}</h2>
      <p class="stat-line">${where || "&nbsp;"}</p>
      <div class="score-chip" style="--chip:${COLORS[r.color]}">Score ${r.score ?? "—"} · ${esc(COLOR_LABELS[r.color])}</div>
      ${r.fails.length ? `<p class="form-error">Misses: ${r.fails.map((k) => esc(metricByKey(k).label)).join(", ")}</p>` : ""}
      ${missing}
      <h3>How it scores</h3>
      ${parts ? `<ul class="score-parts">${parts}</ul>` : `<p class="muted">No criteria are switched on.</p>`}
      ${dataStatus?.rentcast && m.zip ? `<div id="ex-market" class="ex-market"><h3>Market now · ZIP ${esc(m.zip)}</h3><p class="muted small">Loading listings…</p></div>` : ""}
      ${groups}
      ${mix}
      <p class="muted small">Census ${esc(m.acsYear || "")} 5-year estimates${m.zillowMonth ? ` · Zillow ${esc(m.zillowMonth)}` : ""}${
        rate?.rate ? ` · Mortgage payment at ${esc(rate.rate)}% (FRED, ${esc(rate.date)}), 20% down` : ""
      } · OpenStreetMap. Home value and rent data © Zillow, Inc.</p>`;
    if (dataStatus?.rentcast && m.zip) loadMarketSnapshot(m.zip);
  }

  const snapshots = new Map();
  async function loadMarketSnapshot(zip) {
    const el = () => document.querySelector("#ex-market");
    try {
      if (!snapshots.has(zip)) snapshots.set(zip, (await api(`/api/areas/market/${zip}`)).snapshot);
    } catch (err) {
      if (el()) el().innerHTML = `<h3>Market now · ZIP ${esc(zip)}</h3><p class="muted small">${esc(err.message)}</p>`;
      return;
    }
    const s = snapshots.get(zip);
    if (!el() || areas.get(selected)?.metrics?.zip !== zip) return;
    const usd = (v) => formatValue({ fmt: "usd" }, v);
    const n = (v, unit = "") => (v == null ? "—" : `${Math.round(v).toLocaleString()}${unit}`);
    el().innerHTML = `<h3>Market now · ZIP ${esc(zip)}</h3>
      <table class="area-table">
        <tr><th>Homes for sale</th><td>${esc(n(s.sale?.listings))}${s.sale?.newListings ? ` <span class="muted small">(${esc(n(s.sale.newListings))} new)</span>` : ""}</td></tr>
        <tr><th>Median list price</th><td>${esc(usd(s.sale?.medianPrice))}</td></tr>
        <tr><th>Median price per sq ft</th><td>${esc(usd(s.sale?.medianPricePerSqft))}</td></tr>
        <tr><th>Median days on market (sale)</th><td>${esc(n(s.sale?.medianDaysOnMarket, " days"))}</td></tr>
        <tr><th>Rentals listed</th><td>${esc(n(s.rent?.listings))}</td></tr>
        <tr><th>Median asking rent</th><td>${esc(s.rent?.medianRent == null ? "—" : `${usd(s.rent.medianRent)}/mo`)}</td></tr>
        <tr><th>Median days on market (rent)</th><td>${esc(n(s.rent?.medianDaysOnMarket, " days"))}</td></tr>
      </table>
      <p class="muted small">Listings data by RentCast${s.updated ? `, updated ${esc(s.updated)}` : ""}.</p>`;
  }

  function openArea(geoid) {
    const prev = selected;
    selected = geoid;
    if (prev) areaLayer.setFeatureState(prev, { selected: false });
    areaLayer.setFeatureState(geoid, { selected: true });
    $("#view-panel")?.classList.remove("collapsed");
    renderPanel();
    body().scrollTop = 0;
  }

  /* ---------- editing criteria ---------- */

  function markCustom() {
    settings.preset = "custom";
    const sel = $("#ex-preset");
    if (sel) sel.value = "custom";
  }

  function changed() {
    savePrefs();
    rescoreSoon();
  }

  document.addEventListener("input", (e) => {
    if (context !== "explore" || !body()?.contains(e.target)) return;
    const card = e.target.closest(".crit");
    if (card) {
      const cr = criteria[Number(card.dataset.i)];
      const field = e.target.dataset.field;
      const metric = metricByKey(cr.key);
      if (field === "weight") {
        cr.weight = Number(e.target.value);
        card.querySelector("[data-weight-label]").textContent = IMPORTANCE[cr.weight];
      } else if (field === "min" || field === "max") {
        const v = e.target.value === "" ? undefined : Number(e.target.value) / inputScale(metric);
        cr[field] = Number.isFinite(v) ? v : undefined;
      } else if (field === "mode") cr.mode = e.target.value;
      else if (field === "must") cr.must = e.target.checked;
      else if (e.target.dataset.oneof !== undefined) {
        cr.oneOf = [...card.querySelectorAll("[data-oneof]:checked")].map((x) => x.dataset.oneof);
      }
      markCustom();
      return changed();
    }
    if (e.target.id === "ex-green" || e.target.id === "ex-red") {
      const g = Number($("#ex-green").value);
      const r = Number($("#ex-red").value);
      if (Number.isFinite(g) && Number.isFinite(r) && r < g && r >= 1 && g <= 100) {
        settings.green = g;
        settings.red = r;
        changed();
      }
    }
    if (e.target.id === "ex-hide") {
      settings.hideFails = e.target.checked;
      changed();
    }
  });

  document.addEventListener("change", (e) => {
    if (context !== "explore" || !body()?.contains(e.target)) return;
    if (e.target.id === "ex-preset" && PRESETS[e.target.value]) {
      criteria = clone(PRESETS[e.target.value].criteria);
      settings.preset = e.target.value;
      savePrefs();
      renderPanel();
      rescore();
    } else if (e.target.id === "ex-add" && e.target.value) {
      const m = metricByKey(e.target.value);
      criteria.push({ key: m.key, weight: 3, mode: m.mode, ...(m.mode === "oneOf" ? { oneOf: ["Residential"] } : {}) });
      markCustom();
      savePrefs();
      renderPanel();
      rescore();
      body().querySelector(".crit:last-of-type")?.scrollIntoView({ block: "nearest" });
    } else if (e.target.id === "ex-searches") {
      location.hash = e.target.value ? `#/explore/${e.target.value}` : "#/explore";
    }
  });

  document.addEventListener("click", async (e) => {
    if (context !== "explore" || !body()?.contains(e.target)) return;
    const t = e.target.closest("button");
    if (!t) return;
    if (t.dataset.remove !== undefined) {
      criteria.splice(Number(t.dataset.remove), 1);
      markCustom();
      savePrefs();
      renderPanel();
      rescore();
    } else if (t.dataset.area) {
      const a = areas.get(t.dataset.area);
      if (a?.bounds) map.fitBounds(a.bounds, { maxZoom: 15, minZoom: MIN_ZOOM, padding: getPadding() });
      openArea(t.dataset.area);
    } else if (t.dataset.goto) {
      const [lat, lng] = t.dataset.goto.split(",").map(Number);
      map.flyTo([lat, lng], Math.max(map.getZoom(), 14));
      if (areas.has(t.dataset.geoid)) openArea(t.dataset.geoid);
    } else if (t.dataset.marketLoad !== undefined) {
      await loadMarketData(t);
    } else if (t.id === "ex-back") {
      const prev = selected;
      selected = null;
      if (prev) areaLayer.setFeatureState(prev, { selected: false });
      renderPanel();
    } else if (t.id === "ex-locate") {
      locate();
    } else if (t.id === "ex-save") {
      openSaveDialog("create");
    } else if (t.id === "ex-rename") {
      openSaveDialog("rename");
    } else if (t.id === "ex-update") {
      await saveChanges();
    } else if (t.id === "ex-close") {
      location.hash = "#/explore";
    } else if (t.id === "ex-delete") {
      if (!confirm(`Delete the saved search "${search.name}"?`)) return;
      try {
        await api(`/api/searches/${search.id}`, { method: "DELETE" });
        toast("Saved search deleted");
        search = null;
        await refreshSearches();
        location.hash = "#/explore";
      } catch (err) {
        toast(err.message);
      }
    }
  });

  /* ---------- place search with suggestions (Photon, OpenStreetMap data) ---------- */

  let suggestions = [];
  let suggestTimer = null;
  let suggestSeq = 0;

  function placeLabel(p) {
    const parts = [p.name, p.street && p.housenumber ? `${p.housenumber} ${p.street}` : p.street, p.city, p.state, p.postcode];
    return [...new Set(parts.filter(Boolean))].join(", ");
  }

  async function fetchSuggestions(q) {
    const c = map.getCenter();
    const url = `https://photon.komoot.io/api/?q=${encodeURIComponent(q)}&limit=6&lang=en&lat=${c.lat.toFixed(3)}&lon=${c.lng.toFixed(3)}&bbox=-170,15,-60,72`;
    const res = await fetch(url, { headers: { accept: "application/json" } });
    const data = await res.json();
    return (data.features || []).filter((f) => !f.properties?.countrycode || f.properties.countrycode === "US");
  }

  function renderSuggestions() {
    const box = $("#ex-suggest");
    if (!box) return;
    box.hidden = !suggestions.length;
    box.innerHTML = suggestions
      .map((f, i) => `<button type="button" role="option" data-suggest="${i}"><b>${esc(f.properties.name || placeLabel(f.properties))}</b><span>${esc(placeLabel({ ...f.properties, name: "" }))}</span></button>`)
      .join("");
  }

  function goToPlace(f) {
    const ext = f.properties?.extent;
    const [lng, lat] = f.geometry.coordinates;
    suggestions = [];
    renderSuggestions();
    $("#ex-place").value = placeLabel(f.properties);
    if (ext && ext.length === 4) map.fitBounds({ w: ext[0], n: ext[1], e: ext[2], s: ext[3] }, { maxZoom: 15, minZoom: MIN_ZOOM, padding: getPadding() });
    else map.flyTo([lat, lng], 15);
  }

  document.addEventListener("input", (e) => {
    if (e.target.id !== "ex-place") return;
    clearTimeout(suggestTimer);
    const q = e.target.value.trim();
    if (q.length < 3) {
      suggestions = [];
      return renderSuggestions();
    }
    suggestTimer = setTimeout(async () => {
      const seq = ++suggestSeq;
      try {
        const found = await fetchSuggestions(q);
        if (seq === suggestSeq) {
          suggestions = found;
          renderSuggestions();
        }
      } catch {
        /* suggestions are best-effort */
      }
    }, 250);
  });

  document.addEventListener("click", (e) => {
    const b = e.target.closest("[data-suggest]");
    if (b) goToPlace(suggestions[Number(b.dataset.suggest)]);
    else if (!e.composedPath().some((n) => n.classList?.contains("ex-find"))) {
      suggestions = [];
      renderSuggestions();
    }
  });

  document.addEventListener("submit", async (e) => {
    if (e.target.id !== "ex-find") return;
    e.preventDefault();
    const q = $("#ex-place").value.trim();
    if (!q) return;
    try {
      const [hit] = suggestions.length ? suggestions : await fetchSuggestions(q);
      if (!hit) return toast("Couldn't find that place");
      goToPlace(hit);
    } catch {
      toast("Place search is unavailable right now");
    }
  });

  function locate() {
    const fix = getLastFix?.();
    if (fix && Date.now() - fix.t < 5 * 60 * 1000) return map.flyTo([fix.lat, fix.lng], 14);
    if (!navigator.geolocation) return toast("Location isn't available on this device");
    navigator.geolocation.getCurrentPosition(
      (pos) => map.flyTo([pos.coords.latitude, pos.coords.longitude], 14),
      () => toast("Couldn't get your location"),
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 60000 },
    );
  }

  /* ---------- saved searches ---------- */

  function viewState() {
    const b = map.getBounds();
    const c = map.getCenter();
    return {
      center: [c.lat, c.lng],
      zoom: map.getZoom(),
      bounds: [
        [b.getSouth(), b.getWest()],
        [b.getNorth(), b.getEast()],
      ],
    };
  }

  function snapshot() {
    const visible = visibleAreas();
    const top = visible
      .map((a) => ({ a, r: results.get(a.geoid) }))
      .filter((x) => x.r?.score != null)
      .sort((x, y) => y.r.score - x.r.score)
      .slice(0, 40)
      .map(({ a, r }) => ({
        geoid: a.geoid,
        name: a.name,
        score: r.score,
        color: r.color,
        zip: a.metrics?.zip ?? null,
        lat: +((a.bounds.s + a.bounds.n) / 2).toFixed(5),
        lng: +((a.bounds.w + a.bounds.e) / 2).toFixed(5),
      }));
    return { computedAt: Date.now(), counts: countColors(visible), areas: top };
  }

  async function refreshSearches() {
    try {
      const data = await api("/api/searches");
      searches = data.searches;
      searchLimit = data.limit;
    } catch {
      /* list stays as it was */
    }
    const el = $("#ex-saved");
    if (el && context === "explore" && !selected) el.innerHTML = savedSection();
  }

  let dialogMode = "create";
  function openSaveDialog(mode) {
    dialogMode = mode;
    $("#search-dialog-title").textContent = mode === "rename" ? "Rename saved search" : "Save this search";
    $("#search-name").value = mode === "rename" ? search.name : "";
    $("#search-error").hidden = true;
    $("#search-dialog").showModal();
    $("#search-name").focus();
  }

  $("#search-cancel").addEventListener("click", () => $("#search-dialog").close());
  $("#search-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const name = $("#search-name").value.trim();
    try {
      if (dialogMode === "rename") {
        const { search: s } = await api(`/api/searches/${search.id}`, { method: "PATCH", body: { name } });
        search = s;
        toast("Renamed");
      } else {
        const { search: s } = await api("/api/searches", {
          method: "POST",
          body: { name, criteria: { criteria, settings }, view: viewState(), results: snapshot() },
        });
        search = s;
        toast("Search saved");
        history.replaceState(null, "", `#/explore/${s.id}`);
      }
      $("#search-dialog").close();
      await refreshSearches();
      renderPanel();
    } catch (err) {
      if (err.code === "pro_required") {
        $("#search-dialog").close();
        toast(err.message, 5000);
        return openUpgrade();
      }
      $("#search-error").textContent = err.message;
      $("#search-error").hidden = false;
    }
  });

  async function saveChanges() {
    try {
      const { search: s } = await api(`/api/searches/${search.id}`, {
        method: "PATCH",
        body: { criteria: { criteria, settings }, view: viewState(), results: snapshot() },
      });
      search = s;
      toast("Saved search updated");
      await refreshSearches();
      renderPanel();
    } catch (err) {
      toast(err.message);
    }
  }

  async function openSearch(id) {
    try {
      const { search: s } = await api(`/api/searches/${encodeURIComponent(id)}`);
      search = s;
      criteria = (s.criteria?.criteria || []).filter((c) => metricByKey(c.key));
      settings = { ...DEFAULT_SETTINGS, ...(s.criteria?.settings || {}) };
      savePrefs();
      selected = null;
      if (s.view?.bounds) map.fitBounds(s.view.bounds, { padding: 10, maxZoom: 18 });
      renderPanel();
      rescore();
    } catch (err) {
      toast(err.message);
      location.hash = "#/explore";
    }
  }

  /* ---------- context switching ---------- */

  /** Imports Zillow datasets one at a time, for preview versions that have no daily job. */
  async function loadMarketData(btn) {
    btn.disabled = true;
    const status = () => $("#market-load-status");
    try {
      for (let i = 0; i < 12; i++) {
        btn.textContent = "Loading Zillow data…";
        const { result, busy, remaining } = await api("/api/areas/market-load", { method: "POST" });
        if (result && !result.ok) throw new Error(`${result.dataset}: ${result.error}`);
        if (status()) status().textContent = remaining.length ? `${remaining.length} datasets to go…` : "Done.";
        if (!remaining.length) break;
        if (busy && !result) {
          if (status()) status().textContent = "Another import is running. Check back in a few minutes.";
          break;
        }
      }
      await refreshDataStatus();
      load(true);
    } catch (err) {
      btn.disabled = false;
      btn.textContent = "Try again";
      if (status()) status().textContent = err.message;
    }
  }

  async function refreshDataStatus() {
    try {
      dataStatus = await api("/api/areas/status");
      const el = $("#ex-about");
      if (el) el.innerHTML = aboutHtml();
    } catch {
      /* optional */
    }
  }

  /* ---------- Layers panel (base map, area colors, night lights, 3D) ---------- */

  function renderLayersPanel() {
    const el = $("#layers-panel");
    if (!el || el.hidden) return;
    const bases = Object.entries(BASE_STYLES)
      .map(
        ([key, b]) => `<button type="button" class="lp-base lp-base-${key}${map.base === key ? " active" : ""}" data-base="${key}" aria-pressed="${map.base === key}">
          <span class="lp-thumb"></span>${esc(b.label)}</button>`,
      )
      .join("");
    const modes = OVERLAYS.map((o) => {
      const swatch = o.ramp
        ? `<span class="lp-ramp" style="background:linear-gradient(90deg,${o.ramp.join(",")})"></span>`
        : o.id === "score"
          ? `<span class="lp-ramp" style="background:linear-gradient(90deg,${COLORS.red},${COLORS.yellow},${COLORS.green})"></span>`
          : `<span class="lp-ramp lp-off"></span>`;
      return `<button type="button" class="lp-mode${prefs.mode === o.id ? " active" : ""}" data-mode="${o.id}" aria-pressed="${prefs.mode === o.id}">
        ${swatch}<span>${esc(o.label)}${o.source ? `<small>${esc(o.source)}</small>` : o.help ? `<small>${esc(o.help)}</small>` : ""}</span></button>`;
    }).join("");
    el.innerHTML = `
      <div class="lp-head"><b>Map layers</b><button type="button" class="lp-close" data-lp-close aria-label="Close">×</button></div>
      <div class="lp-section">Map type</div>
      <div class="lp-bases">${bases}</div>
      <div class="lp-section">Color neighborhoods by</div>
      <div class="lp-modes">${modes}</div>
      <label class="check lp-check"><input type="checkbox" data-lp="everywhere" ${prefs.everywhere ? "checked" : ""}> Also show on Drive, Trips and My map</label>
      <label class="lp-range">Color strength <input type="range" min="0.15" max="0.8" step="0.05" value="${prefs.opacity}" data-lp="opacity"></label>
      <div class="lp-section">Overlays</div>
      <label class="check lp-check"><input type="checkbox" data-lp="night" ${prefs.night ? "checked" : ""}> Night lights from space <small>NASA Black Marble</small></label>
      <label class="check lp-check"><input type="checkbox" data-lp="flood" ${prefs.flood ? "checked" : ""}> Flood zones <small>FEMA, 100-year floodplain · zoom in to see</small></label>
      <button type="button" class="btn btn-ghost lp-3d" data-lp-3d aria-pressed="${map.threeD}">${map.threeD ? "Flat view" : "3D view"}</button>
      <p class="muted small lp-hint">Drag with two fingers (or right-click drag) to tilt and rotate.</p>`;
  }

  function toggleLayersPanel(force) {
    const el = $("#layers-panel");
    el.hidden = force === undefined ? !el.hidden : !force;
    $("#layers-btn")?.setAttribute("aria-expanded", String(!el.hidden));
    renderLayersPanel();
  }

  $("#layers-btn")?.addEventListener("click", (e) => {
    e.stopPropagation();
    toggleLayersPanel();
  });
  $("#threed-btn")?.addEventListener("click", () => {
    map.set3D(!map.threeD);
    $("#threed-btn").setAttribute("aria-pressed", String(map.threeD));
    renderLayersPanel();
  });

  $("#layers-panel")?.addEventListener("click", (e) => {
    const t = e.target.closest("button");
    if (!t) return;
    if (t.dataset.lpClose !== undefined) return toggleLayersPanel(false);
    if (t.dataset.base) {
      map.setBase(t.dataset.base);
      try {
        localStorage.setItem("gz_base", t.dataset.base);
      } catch {
        /* not critical */
      }
    } else if (t.dataset.mode) {
      prefs.mode = t.dataset.mode;
      if (mapContext && mapContext !== "explore" && prefs.mode !== "off") prefs.everywhere = true;
      savePrefs();
      setContext(mapContext, null, true);
    } else if (t.dataset.lp3d !== undefined) {
      map.set3D(!map.threeD);
      $("#threed-btn")?.setAttribute("aria-pressed", String(map.threeD));
    }
    renderLayersPanel();
  });

  $("#layers-panel")?.addEventListener("input", (e) => {
    const key = e.target.dataset.lp;
    if (key === "opacity") {
      prefs.opacity = Number(e.target.value);
      paint();
    } else if (key === "night") {
      prefs.night = e.target.checked;
      applyLayers();
    } else if (key === "flood") {
      prefs.flood = e.target.checked;
      if (prefs.flood && !dataStatus) refreshDataStatus().then(applyLayers);
      applyLayers();
    } else if (key === "everywhere") {
      prefs.everywhere = e.target.checked;
      setContext(mapContext, null, true);
    }
    savePrefs();
  });

  document.addEventListener("click", (e) => {
    const el = $("#layers-panel");
    // composedPath() still lists the panel when the clicked button was re-rendered away.
    if (el && !el.hidden && !e.composedPath().includes(el) && !e.target.closest("#layers-btn")) toggleLayersPanel(false);
  });

  map.on("style", () => {
    // A new base style starts without feature-state, so re-apply hover/selection colors.
    if (context) paint();
  });

  /* ---------- context switching ---------- */

  let mapContext = null;

  /**
   * ctx: "explore" (full view), "drive" or "view" (trip / My map: area colors only if switched on
   * everywhere), or null (a page covers the map).
   */
  function setContext(ctx, searchId = null, keepSearch = false) {
    mapContext = ctx;
    const next = ctx === "explore" ? "explore" : (ctx === "drive" || ctx === "view") && prefs.everywhere ? "passive" : null;
    const entering = next === "explore" && context !== "explore";
    context = next;
    $("#map-fabs").hidden = !ctx;
    if (!ctx) toggleLayersPanel(false);
    if (context === "explore" && !keepSearch) {
      if (searchId && searchId !== search?.id) openSearch(searchId);
      else if (!searchId && search) search = null;
      if (entering) {
        refreshSearches();
        refreshDataStatus().then(applyLayers);
        segments = null;
      }
      renderPanel();
    } else if (ctx && !dataStatus) refreshDataStatus().then(applyLayers);
    applyLayers();
    if (context) {
      load();
      rescore();
    }
  }

  return { setContext };
}
