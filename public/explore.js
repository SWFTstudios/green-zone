/* Explore: score census tracts against the user's criteria and color them green / yellow / red. */
/* global L */
import {
  DEFAULT_SETTINGS,
  GROUPS,
  IMPORTANCE,
  LAND_USES,
  METRICS,
  PRESETS,
  driveRatings,
  formatValue,
  geometryBounds,
  inputScale,
  metricByKey,
  scoreAreas,
} from "./areas-core.js";

const COLORS = { green: "#16a34a", yellow: "#eab308", red: "#dc2626", fail: "#7f1d1d", nodata: "#94a3b8", pending: "#94a3b8" };
const COLOR_LABELS = { green: "Green", yellow: "Yellow", red: "Red", fail: "Misses a must-have", nodata: "Not enough data", pending: "Loading" };
const PREFS_KEY = "gz_explore_v1";
const MIN_ZOOM = 12;
const MAX_POLLS = 30;

const clone = (v) => JSON.parse(JSON.stringify(v));

function loadPrefs() {
  try {
    const p = JSON.parse(localStorage.getItem(PREFS_KEY) || "null");
    if (p && Array.isArray(p.criteria)) {
      return {
        criteria: p.criteria.filter((c) => metricByKey(c.key)),
        settings: { ...DEFAULT_SETTINGS, ...(p.settings || {}) },
        overlay: !!p.overlay,
      };
    }
  } catch {
    /* storage blocked or corrupt: start from defaults */
  }
  return { criteria: clone(PRESETS.balanced.criteria), settings: { ...DEFAULT_SETTINGS }, overlay: false };
}

export function createExplore({ map, api, esc, toast, openUpgrade, getZones, getLastFix }) {
  const $ = (sel) => document.querySelector(sel);
  const pane = map.createPane("areas");
  pane.style.zIndex = "350";
  const layer = L.layerGroup();

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
      localStorage.setItem(PREFS_KEY, JSON.stringify({ criteria, settings, overlay: prefs.overlay }));
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
    if (!context) return;
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
        ensureShape(a);
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
    moveTimer = setTimeout(() => load(), context === "drive" ? 1500 : 450);
  });

  /* ---------- map layer ---------- */

  function styleFor(geoid) {
    const r = results.get(geoid);
    const color = r?.color || "pending";
    const hidden = color === "fail" && settings.hideFails;
    const isSelected = geoid === selected;
    const fill = context === "drive" ? 0.18 : color === "pending" || color === "nodata" ? 0.08 : 0.38;
    return {
      pane: "areas",
      color: isSelected ? "#0f172a" : COLORS[color],
      weight: isSelected ? 3 : 1,
      opacity: hidden ? 0 : 0.8,
      fillColor: COLORS[color],
      fillOpacity: hidden ? 0 : fill,
      dashArray: color === "fail" ? "4 4" : null,
    };
  }

  function ensureShape(a) {
    if (a.shape || !a.geometry) return;
    a.shape = L.geoJSON(a.geometry, { style: () => styleFor(a.geoid), pane: "areas" });
    a.shape.on("click", () => context === "explore" && openArea(a.geoid));
    a.shape.bindTooltip(() => {
      const r = results.get(a.geoid);
      return `${esc(a.name)}${r?.score != null ? ` · ${r.score}` : ""}`;
    }, { sticky: true });
    a.shape.addTo(layer);
  }

  function restyleAll() {
    for (const a of areas.values()) a.shape?.setStyle(styleFor(a.geoid));
  }

  function rescore() {
    results = scoreAreas(visibleAreas(), criteria, settings);
    restyleAll();
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
    return `
      <p><b>Home values and rents</b> come from Zillow Research (ZHVI and ZORI) by ZIP code${
        loaded.length ? `, latest month ${esc(loaded.map((d) => d.month).filter(Boolean).sort().pop() || "")}` : ""
      }. ${loaded.length ? `${loaded.length} of ${zillow.length} Zillow datasets loaded.` : "Zillow data hasn't been imported yet, so Census figures are used instead."}${
        failed.length ? ` <span class="ex-notice">Import problem: ${esc(failed[0].label)}: ${esc(failed[0].error)}</span>` : ""
      }</p>
      <p><b>Housing and economy</b> come from the Census American Community Survey 5-year estimates for each tract. Only housing, market and economic figures are used. Nothing about race, ethnicity, religion, sex, family status or disability goes into a score.</p>
      <p><b>Outdoors, lighting, amenities and land use</b> come from OpenStreetMap. That data is crowd-mapped, so coverage varies by city. "Outdoor activity" counts parks, trails and fitness spots; it is not Strava data, whose terms don't allow sharing it across users.</p>
      <p><b>Zoning:</b> there's no free nationwide zoning dataset. "Main land use" is what's mapped on the ground, not the legal zoning. Check the city or county zoning map before you buy.</p>
      <p><b>Crime</b> isn't included; there's no reliable nationwide source by neighborhood. Your own drive ratings can stand in for what you see.</p>
      <p class="muted small">Home value and rent data © Zillow, Inc., Zillow Research. Map data © OpenStreetMap contributors. Census Bureau data.</p>`;
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
      ? `<p class="ex-notice">Still loading: ${esc(m.missing.join(", "))}. It will retry automatically.</p>`
      : "";
    body().innerHTML = `
      <button class="btn btn-link ex-back" type="button" id="ex-back">← Back to results</button>
      <h2>${esc(a.name)}</h2>
      <p class="stat-line">${where || "&nbsp;"}</p>
      <div class="score-chip" style="--chip:${COLORS[r.color]}">Score ${r.score ?? "—"} · ${esc(COLOR_LABELS[r.color])}</div>
      ${r.fails.length ? `<p class="form-error">Misses: ${r.fails.map((k) => esc(metricByKey(k).label)).join(", ")}</p>` : ""}
      ${missing}
      <h3>How it scores</h3>
      ${parts ? `<ul class="score-parts">${parts}</ul>` : `<p class="muted">No criteria are switched on.</p>`}
      ${groups}
      ${mix}
      <p class="muted small">Census ${esc(m.acsYear || "")} 5-year estimates${m.zillowMonth ? ` · Zillow ${esc(m.zillowMonth)}` : ""} · OpenStreetMap. Home value and rent data © Zillow, Inc.</p>`;
  }

  function openArea(geoid) {
    const prev = selected;
    selected = geoid;
    if (prev) areas.get(prev)?.shape?.setStyle(styleFor(prev));
    areas.get(geoid)?.shape?.setStyle(styleFor(geoid));
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
      if (a?.shape) map.fitBounds(a.shape.getBounds(), { maxZoom: 15, padding: [30, 30] });
      openArea(t.dataset.area);
    } else if (t.dataset.goto) {
      const [lat, lng] = t.dataset.goto.split(",").map(Number);
      map.setView([lat, lng], Math.max(map.getZoom(), 14));
      if (areas.has(t.dataset.geoid)) openArea(t.dataset.geoid);
    } else if (t.id === "ex-back") {
      const prev = selected;
      selected = null;
      areas.get(prev)?.shape?.setStyle(styleFor(prev));
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

  document.addEventListener("submit", async (e) => {
    if (e.target.id !== "ex-find") return;
    e.preventDefault();
    const q = $("#ex-place").value.trim();
    if (!q) return;
    try {
      const res = await fetch(`https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&countrycodes=us&q=${encodeURIComponent(q)}`, {
        headers: { accept: "application/json" },
      });
      const [hit] = await res.json();
      if (!hit) return toast("Couldn't find that place");
      const [s, n, w, ee] = hit.boundingbox.map(Number);
      map.fitBounds([[s, w], [n, ee]], { maxZoom: 14 });
      if (map.getZoom() < MIN_ZOOM) map.setZoom(MIN_ZOOM);
    } catch {
      toast("Place search is unavailable right now");
    }
  });

  function locate() {
    const fix = getLastFix?.();
    if (fix && Date.now() - fix.t < 5 * 60 * 1000) return map.setView([fix.lat, fix.lng], 14);
    if (!navigator.geolocation) return toast("Location isn't available on this device");
    navigator.geolocation.getCurrentPosition(
      (pos) => map.setView([pos.coords.latitude, pos.coords.longitude], 14),
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
      if (s.view?.bounds) map.fitBounds(s.view.bounds);
      renderPanel();
      rescore();
    } catch (err) {
      toast(err.message);
      location.hash = "#/explore";
    }
  }

  /* ---------- context switching ---------- */

  async function refreshDataStatus() {
    try {
      dataStatus = await api("/api/areas/status");
      const el = $("#ex-about");
      if (el) el.innerHTML = aboutHtml();
    } catch {
      /* optional */
    }
  }

  /** ctx: "explore" (full view), "drive" (faint overlay if switched on) or null (hidden). */
  function setContext(ctx, searchId = null) {
    const next = ctx === "explore" ? "explore" : ctx === "drive" && prefs.overlay ? "drive" : null;
    const entering = next === "explore" && context !== "explore";
    context = next;
    pane.classList.toggle("areas-passive", context === "drive");
    if (!context) {
      map.removeLayer(layer);
      return;
    }
    map.addLayer(layer);
    restyleAll();
    if (context === "explore") {
      if (searchId && searchId !== search?.id) openSearch(searchId);
      else if (!searchId && search) search = null;
      if (entering) {
        refreshSearches();
        refreshDataStatus();
        segments = null;
      }
      renderPanel();
    }
    load();
  }

  function setOverlay(on) {
    prefs.overlay = on;
    savePrefs();
    setContext("drive");
  }

  return { setContext, setOverlay, overlayOn: () => prefs.overlay };
}
