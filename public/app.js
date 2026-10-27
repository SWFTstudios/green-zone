/* Green Zone client: paint streets by color while driving, save trips, review them on a map. */
/* global L */
import { createExplore } from "./explore.js";

const $ = (sel) => document.querySelector(sel);
const esc = (value) =>
  String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

const MIN_POINT_SPACING_M = 5;
const MAX_ACCURACY_M = 75;
const MAX_PLAUSIBLE_SPEED_MPS = 70;
const FIX_FRESH_MS = 30000;

const state = {
  user: null,
  zones: [],
  view: null,
  lastFix: null,
  follow: true,
  drawMode: false,
  watchId: null,
  wakeLock: null,
  draft: null,
  firstFix: true,
};

/* ---------- helpers ---------- */

function haversine(a, b) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b[0] - a[0]);
  const dLng = toRad(b[1] - a[1]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a[0])) * Math.cos(toRad(b[0])) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function pathLength(path) {
  let total = 0;
  for (let i = 1; i < path.length; i++) total += haversine(path[i - 1], path[i]);
  return total;
}

function fmtMiles(meters) {
  const mi = meters / 1609.344;
  return `${mi < 1 ? mi.toFixed(2) : mi.toFixed(1)} mi`;
}

function fmtDuration(ms) {
  const totalMin = Math.max(0, Math.floor(ms / 60000));
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return h ? `${h} h ${m} min` : `${m} min`;
}

function fmtClock(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const hh = Math.floor(s / 3600);
  const mm = String(Math.floor((s % 3600) / 60)).padStart(2, "0");
  const ss = String(s % 60).padStart(2, "0");
  return hh ? `${hh}:${mm}:${ss}` : `${mm}:${ss}`;
}

function fmtDate(ts) {
  return new Date(ts).toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

let toastTimer;
function toast(message, ms = 2600) {
  const el = $("#toast");
  el.textContent = message;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.hidden = true), ms);
}

function showError(el, message) {
  el.textContent = message;
  el.hidden = !message;
}

async function api(path, { method = "GET", body } = {}) {
  let res;
  try {
    res = await fetch(path, {
      method,
      credentials: "same-origin",
      headers: body ? { "content-type": "application/json" } : {},
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    const err = new Error("No connection. Check your signal and try again.");
    err.network = true;
    throw err;
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || `Request failed (${res.status}).`);
    err.status = res.status;
    err.code = data.code;
    if (res.status === 401 && state.user) {
      state.user = null;
      route();
    }
    throw err;
  }
  return data;
}

/* ---------- map ---------- */

const map = L.map("map", { zoomControl: true, attributionControl: true }).setView([39.5, -98.35], 4);
L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 19,
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
}).addTo(map);
map.zoomControl.setPosition("topright");

const driveLayer = L.layerGroup();
const viewLayer = L.layerGroup();
const meLayer = L.layerGroup().addTo(map);
let meDot = null;
let meRing = null;

function zoneById(id) {
  return state.zones.find((z) => z.id === id);
}

function lineStyle(color) {
  return { color, weight: 8, opacity: 0.85, lineCap: "round", lineJoin: "round" };
}

function pinMarker(pin, color) {
  const icon = L.divIcon({
    className: "",
    html: `<div class="pin-icon" style="background:${esc(color || "#475569")}"><span>✎</span></div>`,
    iconSize: [26, 26],
    iconAnchor: [13, 26],
    popupAnchor: [0, -24],
  });
  const marker = L.marker([pin.lat, pin.lng], { icon });
  marker.bindPopup(esc(pin.note || "(no text)"));
  return marker;
}

map.on("dragstart", () => {
  if (state.view === "drive" && state.follow) setFollow(false);
});

/* ---------- auth ---------- */

let pendingEmail = "";

$("#login-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const email = $("#login-email").value.trim();
  const btn = e.submitter;
  btn.disabled = true;
  showError($("#login-error"), "");
  try {
    const data = await api("/api/auth/request", { method: "POST", body: { email } });
    pendingEmail = email;
    $("#code-email").textContent = email;
    $("#login-form").hidden = true;
    $("#code-form").hidden = false;
    const dev = $("#dev-code");
    dev.hidden = !data.devCode;
    if (data.devCode) dev.textContent = `Dev mode: your code is ${data.devCode}`;
    $("#login-code").focus();
  } catch (err) {
    showError($("#login-error"), err.message);
  } finally {
    btn.disabled = false;
  }
});

$("#code-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const btn = e.submitter;
  btn.disabled = true;
  showError($("#login-error"), "");
  try {
    await signIn(pendingEmail, $("#login-code").value);
  } catch (err) {
    showError($("#login-error"), err.message);
  } finally {
    btn.disabled = false;
  }
});

$("#code-back").addEventListener("click", () => {
  $("#code-form").hidden = true;
  $("#login-form").hidden = false;
  showError($("#login-error"), "");
});

async function signIn(email, code) {
  const wasGuest = !!state.user?.isGuest;
  const oldDraftKey = draftKey();
  const data = await api("/api/auth/verify", { method: "POST", body: { email, code } });
  await loadSession();
  carryDraft(oldDraftKey);
  setSignedOut(false);
  $("#login-code").value = "";
  $("#code-form").hidden = true;
  $("#login-form").hidden = false;
  location.hash = "#/drive";
  route();
  if (data.merged) toast("Signed in. Everything you made as a guest is now in your account.", 4500);
  else if (wasGuest) toast("Your work is saved to your email now.", 4000);
  else if (data.isNew) toast("Welcome! Tap a color to start painting.");
}

function setSignedOut(value) {
  try {
    if (value) localStorage.setItem("gz_signed_out", "1");
    else localStorage.removeItem("gz_signed_out");
  } catch {
    /* storage blocked */
  }
}

function signedOutBefore() {
  try {
    return localStorage.getItem("gz_signed_out") === "1";
  } catch {
    return false;
  }
}

async function startGuest() {
  await api("/api/auth/guest", { method: "POST" });
  setSignedOut(false);
  await loadSession();
}

$("#guest-btn").addEventListener("click", async (e) => {
  e.target.disabled = true;
  showError($("#login-error"), "");
  try {
    await startGuest();
    location.hash = "#/drive";
    route();
    toast("You're in as a guest. Add your email from the menu any time to keep your work.", 4500);
  } catch (err) {
    showError($("#login-error"), err.message);
  } finally {
    e.target.disabled = false;
  }
});

$("#login-back").addEventListener("click", () => {
  location.hash = "#/drive";
});

$("#save-account-btn").addEventListener("click", () => {
  $("#account-menu").hidden = true;
  location.hash = "#/signin";
});

async function loadSession() {
  const { user } = await api("/api/me");
  state.user = user;
  if (user) {
    const { zones } = await api("/api/zones");
    state.zones = zones;
    state.draft = loadDraft();
  }
  renderAccount();
}

function renderAccount() {
  const u = state.user;
  $("#topbar").hidden = !u;
  if (!u) return;
  const pro = u.plan === "pro";
  for (const el of [$("#plan-badge"), $("#key-plan")]) {
    el.textContent = u.isGuest ? "Guest" : pro ? "Pro" : "Free";
    el.classList.toggle("pro", pro && !u.isGuest);
    el.classList.toggle("guest", !!u.isGuest);
  }
  $("#account-email").textContent = u.isGuest ? "Guest: saved in this browser only" : u.email;
  $("#save-account-btn").hidden = !u.isGuest;
  $("#logout-btn").textContent = u.isGuest ? "Leave guest mode" : "Sign out";
  $("#finish-email-row").hidden = !!u.isGuest;
  if (u.isGuest) $("#finish-email").checked = false;
  $("#upgrade-btn").textContent = pro ? "Pro features" : "Upgrade to Pro";
}

$("#account-btn").addEventListener("click", (e) => {
  e.stopPropagation();
  const menu = $("#account-menu");
  menu.hidden = !menu.hidden;
  $("#account-btn").setAttribute("aria-expanded", String(!menu.hidden));
});
document.addEventListener("click", (e) => {
  if (!$("#account-menu").contains(e.target)) $("#account-menu").hidden = true;
});
$("#upgrade-btn").addEventListener("click", () => openUpgrade());
$("#logout-btn").addEventListener("click", async () => {
  if (state.user?.isGuest) {
    if (!confirm("You're using a guest account. If you leave, you won't be able to get back to its trips and saved searches. Add your email first to keep them. Leave anyway?")) return;
  } else if (state.draft && !confirm("You have a trip in progress on this device. Sign out anyway? It stays saved here for next time.")) return;
  await api("/api/auth/logout", { method: "POST" }).catch(() => {});
  setSignedOut(true);
  stopGps();
  state.user = null;
  state.draft = null;
  driveLayer.clearLayers();
  location.hash = "";
  route();
});

function openUpgrade() {
  $("#account-menu").hidden = true;
  $("#upgrade-status").textContent =
    state.user?.plan === "pro"
      ? "You're on Pro. Add your own zones on the Key page."
      : "Online checkout isn't switched on yet. To get Pro now, ask the app owner to add your email to the Pro list.";
  $("#upgrade-dialog").showModal();
}

/* ---------- draft trip (persisted on this device) ---------- */

const draftKey = () => `gz_draft_v1:${state.user?.id || ""}`;

/** Keeps a trip in progress when the account changes (a guest adding an email, or an older email-keyed draft). */
function carryDraft(fromKey) {
  try {
    const legacy = state.user?.email ? `gz_draft_v1:${state.user.email}` : null;
    for (const key of [fromKey, legacy]) {
      if (!key || key === draftKey()) continue;
      const raw = localStorage.getItem(key);
      if (raw && !localStorage.getItem(draftKey())) localStorage.setItem(draftKey(), raw);
      localStorage.removeItem(key);
    }
    state.draft = loadDraft();
  } catch {
    /* storage blocked: nothing to carry */
  }
}
let saveTimer = null;

function loadDraft() {
  try {
    const raw = localStorage.getItem(draftKey());
    const draft = raw ? JSON.parse(raw) : null;
    if (draft) draft.activeZoneId = null; // never resume painting silently after a reload
    return draft;
  } catch {
    return null;
  }
}

function saveDraftNow() {
  clearTimeout(saveTimer);
  saveTimer = null;
  try {
    if (state.draft) localStorage.setItem(draftKey(), JSON.stringify(state.draft));
    else localStorage.removeItem(draftKey());
  } catch {
    /* storage full or blocked: the trip still lives in memory */
  }
}

function saveDraftSoon() {
  if (!saveTimer) saveTimer = setTimeout(saveDraftNow, 2000);
}

function ensureDraft() {
  if (!state.draft) {
    state.draft = { id: crypto.randomUUID(), startedAt: Date.now(), segments: [], pins: [], activeZoneId: null };
  }
  return state.draft;
}

function openSegment() {
  const d = state.draft;
  if (!d || !d.activeZoneId) return null;
  return d.segments[d.segments.length - 1] || null;
}

let segmentLines = [];

function renderDraft() {
  driveLayer.clearLayers();
  segmentLines = [];
  const d = state.draft;
  if (!d) return;
  for (const seg of d.segments) {
    const line = L.polyline(seg.path, lineStyle(zoneById(seg.zoneTypeId)?.color || "#64748b")).addTo(driveLayer);
    segmentLines.push(line);
  }
  for (const pin of d.pins) pinMarker(pin, zoneById(pin.zoneTypeId)?.color).addTo(driveLayer);
}

function freshFix() {
  const f = state.lastFix;
  return f && Date.now() - f.t < FIX_FRESH_MS && f.acc <= MAX_ACCURACY_M ? f : null;
}

function closeSegment() {
  const d = state.draft;
  const seg = openSegment();
  if (!seg) return null;
  seg.endedAt = Date.now();
  if (seg.path.length < 2) {
    d.segments.pop();
    segmentLines.pop()?.remove();
    return null;
  }
  return seg;
}

function selectZone(zoneId) {
  const zone = zoneById(zoneId);
  if (!zone) return;
  if (zone.locked) return openUpgrade();
  const d = ensureDraft();
  if (d.activeZoneId === zoneId) return pausePainting();

  const previous = closeSegment();
  d.activeZoneId = zoneId;
  const seg = { zoneTypeId: zoneId, path: [], startedAt: Date.now(), endedAt: Date.now() };
  // Switching colors mid-street continues the line from where the last color stopped.
  const fix = freshFix();
  if (previous) seg.path.push(previous.path[previous.path.length - 1]);
  else if (fix && !state.drawMode) seg.path.push([fix.lat, fix.lng]);
  d.segments.push(seg);
  segmentLines.push(L.polyline(seg.path, lineStyle(zone.color)).addTo(driveLayer));

  saveDraftNow();
  startGps();
  requestWakeLock();
  if (navigator.vibrate) navigator.vibrate(30);
  renderDock();
}

function pausePainting() {
  const d = state.draft;
  if (!d) return;
  closeSegment();
  d.activeZoneId = null;
  saveDraftNow();
  renderDock();
}

function addPoint(latlng, { manual = false } = {}) {
  const seg = openSegment();
  if (!seg) return;
  const pt = [Math.round(latlng[0] * 1e6) / 1e6, Math.round(latlng[1] * 1e6) / 1e6];
  const last = seg.path[seg.path.length - 1];
  const now = Date.now();
  if (last && !manual) {
    const dist = haversine(last, pt);
    if (dist < MIN_POINT_SPACING_M) return;
    const dt = Math.max(1, (now - (seg.lastPointAt || seg.startedAt)) / 1000);
    if (dist > 200 && dist / dt > MAX_PLAUSIBLE_SPEED_MPS) return; // GPS jump
  }
  seg.path.push(pt);
  seg.lastPointAt = now;
  seg.endedAt = now;
  segmentLines[segmentLines.length - 1]?.addLatLng(pt);
  saveDraftSoon();
  renderStats();
}

function undo() {
  const d = state.draft;
  if (!d) return;
  const seg = openSegment();
  if (state.drawMode && seg && seg.path.length > 1) {
    seg.path.pop();
    segmentLines[segmentLines.length - 1].setLatLngs(seg.path);
  } else {
    const lastSeg = d.segments[d.segments.length - 1];
    const lastPin = d.pins[d.pins.length - 1];
    if (lastPin && (!lastSeg || lastPin.createdAt > lastSeg.startedAt)) {
      d.pins.pop();
      toast("Removed the last note");
    } else if (lastSeg) {
      if (seg) d.activeZoneId = null;
      d.segments.pop();
      toast("Removed the last painted stretch");
    }
    renderDraft();
  }
  saveDraftNow();
  renderDock();
}

/* ---------- GPS ---------- */

function setGpsStatus(kind, text) {
  const dot = $("#gps-dot");
  dot.className = `gps-dot ${kind}`;
  $("#gps-text").textContent = text;
}

function startGps() {
  if (state.watchId !== null) return;
  if (!("geolocation" in navigator)) {
    setGpsStatus("err", "No GPS on this device");
    return;
  }
  setGpsStatus("weak", "Finding you…");
  state.watchId = navigator.geolocation.watchPosition(onPosition, onPositionError, {
    enableHighAccuracy: true,
    maximumAge: 2000,
    timeout: 20000,
  });
}

function stopGps() {
  if (state.watchId !== null) navigator.geolocation.clearWatch(state.watchId);
  state.watchId = null;
}

function onPosition(pos) {
  const { latitude: lat, longitude: lng, accuracy: acc } = pos.coords;
  state.lastFix = { lat, lng, acc, t: Date.now() };
  const ll = [lat, lng];
  if (!meDot) {
    meRing = L.circle(ll, { radius: acc, color: "#2563eb", weight: 1, fillOpacity: 0.08, interactive: false }).addTo(meLayer);
    meDot = L.circleMarker(ll, { radius: 8, color: "#fff", weight: 3, fillColor: "#2563eb", fillOpacity: 1, interactive: false }).addTo(meLayer);
  } else {
    meDot.setLatLng(ll);
    meRing.setLatLng(ll).setRadius(acc);
  }
  if (acc <= 30) setGpsStatus("ok", `GPS ±${Math.round(acc)} m`);
  else if (acc <= MAX_ACCURACY_M) setGpsStatus("weak", `GPS ±${Math.round(acc)} m`);
  else setGpsStatus("weak", `Weak GPS ±${Math.round(acc)} m`);

  if (state.view === "drive" && state.follow) {
    if (state.firstFix) map.setView(ll, 17);
    else map.panTo(ll, { animate: true });
  }
  state.firstFix = false;
  if (!state.drawMode && acc <= MAX_ACCURACY_M) addPoint(ll);
}

function onPositionError(err) {
  if (err.code === err.PERMISSION_DENIED) {
    setGpsStatus("err", "Location blocked");
    toast("Location is blocked. Allow it in your browser settings, or use ✎ to draw by tapping.", 5000);
    stopGps();
  } else {
    setGpsStatus("weak", "Searching for GPS…");
  }
}

async function requestWakeLock() {
  try {
    if ("wakeLock" in navigator && !state.wakeLock && document.visibilityState === "visible") {
      state.wakeLock = await navigator.wakeLock.request("screen");
      state.wakeLock.addEventListener("release", () => (state.wakeLock = null));
    }
  } catch {
    /* not supported or denied; the screen may sleep */
  }
}

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && state.draft) requestWakeLock();
  if (document.visibilityState === "hidden") saveDraftNow();
});
window.addEventListener("pagehide", saveDraftNow);

function setFollow(on) {
  state.follow = on;
  $("#follow-btn").setAttribute("aria-pressed", String(on));
  if (on && state.lastFix) map.setView([state.lastFix.lat, state.lastFix.lng], Math.max(map.getZoom(), 16));
}

$("#follow-btn").addEventListener("click", () => setFollow(!state.follow));
$("#draw-btn").addEventListener("click", () => {
  state.drawMode = !state.drawMode;
  $("#draw-btn").setAttribute("aria-pressed", String(state.drawMode));
  if (state.drawMode) setFollow(false);
  toast(state.drawMode ? "Draw mode: pick a color, then tap along the street" : "GPS mode: streets paint as you drive");
  renderDock();
});

map.on("click", (e) => {
  if (state.view !== "drive" || !state.drawMode) return;
  if (!openSegment()) return toast("Pick a color first");
  addPoint([e.latlng.lat, e.latlng.lng], { manual: true });
});

/* ---------- drive UI ---------- */

function renderDock() {
  const d = state.draft;
  const wrap = $("#zone-buttons");
  wrap.innerHTML = state.zones
    .map(
      (z) => `<button type="button" class="zone-btn${d?.activeZoneId === z.id ? " active" : ""}" data-zone="${esc(z.id)}"
        style="background:${esc(z.color)}" aria-pressed="${d?.activeZoneId === z.id}" title="${esc(z.description)}">
        ${z.locked ? "🔒 " : ""}${esc(z.name.replace(/ zone$/i, ""))}</button>`,
    )
    .join("");

  const active = d?.activeZoneId ? zoneById(d.activeZoneId) : null;
  let hint;
  if (!d) hint = state.drawMode ? "Pick a color, then tap along the street to paint it." : "Tap a color to start painting the street you're on.";
  else if (active) hint = state.drawMode ? `Tap the map to paint ${active.name}. Tap ${active.name.replace(/ zone$/i, "")} again to pause.` : `Painting ${active.name}. Switch colors when the neighborhood changes.`;
  else hint = "Paused. Tap a color to keep painting.";
  $("#dock-hint").textContent = hint;

  const hasContent = !!d && (d.segments.some((s) => s.path.length >= 2) || d.pins.length > 0);
  $("#pause-btn").disabled = !active;
  $("#note-btn").disabled = !d;
  $("#undo-btn").disabled = !d || (d.segments.length === 0 && d.pins.length === 0);
  $("#finish-btn").disabled = !d;
  $("#finish-btn").textContent = hasContent || !d ? "Finish trip" : "End trip";
  renderStats();
}

$("#zone-buttons").addEventListener("click", (e) => {
  const btn = e.target.closest("[data-zone]");
  if (btn) selectZone(btn.dataset.zone);
});
$("#pause-btn").addEventListener("click", pausePainting);
$("#undo-btn").addEventListener("click", undo);

function metersByZone(segments) {
  const out = {};
  for (const s of segments) out[s.zoneTypeId] = (out[s.zoneTypeId] || 0) + pathLength(s.path);
  return out;
}

function renderStats() {
  const d = state.draft;
  if (!d) {
    $("#hud-stats").innerHTML = "";
    $("#hud-clock").textContent = "";
    return;
  }
  const totals = metersByZone(d.segments);
  $("#hud-stats").innerHTML = Object.entries(totals)
    .map(([id, m]) => `<span class="hud-stat"><i style="background:${esc(zoneById(id)?.color || "#64748b")}"></i>${fmtMiles(m)}</span>`)
    .join("");
  $("#hud-clock").textContent = fmtClock(Date.now() - d.startedAt);
}
setInterval(() => state.view === "drive" && renderStats(), 1000);

/* notes */
let notePosition = null;
$("#note-btn").addEventListener("click", () => {
  const fix = !state.drawMode && freshFix();
  const c = map.getCenter();
  notePosition = fix ? [fix.lat, fix.lng] : [c.lat, c.lng];
  $("#note-where").textContent = fix ? "Pinned at your current location." : "Pinned at the center of the map.";
  $("#note-text").value = "";
  $("#note-dialog").showModal();
  $("#note-text").focus();
});
$("#note-cancel").addEventListener("click", () => $("#note-dialog").close());
$("#note-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const d = ensureDraft();
  const pin = {
    lat: notePosition[0],
    lng: notePosition[1],
    note: $("#note-text").value.trim(),
    zoneTypeId: d.activeZoneId || null,
    createdAt: Date.now(),
  };
  d.pins.push(pin);
  pinMarker(pin, zoneById(pin.zoneTypeId)?.color).addTo(driveLayer);
  saveDraftNow();
  $("#note-dialog").close();
  renderDock();
  toast("Note dropped");
});

/* finish */
$("#finish-btn").addEventListener("click", () => {
  const d = state.draft;
  if (!d) return;
  pausePainting();
  const usable = d.segments.filter((s) => s.path.length >= 2);
  if (usable.length === 0 && d.pins.length === 0) {
    if (confirm("Nothing has been painted yet. End this trip without saving?")) discardDraft();
    return;
  }
  const totals = metersByZone(usable);
  const total = Object.values(totals).reduce((a, b) => a + b, 0);
  $("#finish-summary").textContent = `${fmtMiles(total)} painted · ${fmtDuration(Date.now() - d.startedAt)} · ${d.pins.length} note${d.pins.length === 1 ? "" : "s"}`;
  if (!$("#finish-name").value) {
    $("#finish-name").value = `Drive · ${new Date(d.startedAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}`;
  }
  const used = new Set([...usable.map((s) => s.zoneTypeId), ...d.pins.map((p) => p.zoneTypeId).filter(Boolean)]);
  $("#finish-legend").innerHTML = state.zones
    .filter((z) => used.has(z.id))
    .map(
      (z) => `<div class="entry">
        <div class="entry-head"><span class="sw" style="background:${esc(z.color)}"></span>${esc(z.name)}
          <span class="muted small">· ${fmtMiles(totals[z.id] || 0)}</span></div>
        <p>${esc(z.description || "No meaning set yet. Add one on the Key page.")}</p>
        <input data-legend="${esc(z.id)}" maxlength="1000" placeholder="What you saw on this trip (optional)">
      </div>`,
    )
    .join("");
  showError($("#finish-error"), "");
  $("#finish-dialog").showModal();
});

$("#finish-cancel").addEventListener("click", () => {
  $("#finish-dialog").close();
  toast("Paused. Tap a color to keep painting.");
});

$("#finish-discard").addEventListener("click", () => {
  if (!confirm("Delete this trip? What you painted will be lost.")) return;
  $("#finish-dialog").close();
  discardDraft();
});

function discardDraft() {
  state.draft = null;
  $("#finish-name").value = "";
  $("#finish-notes").value = "";
  saveDraftNow();
  renderDraft();
  renderDock();
  state.wakeLock?.release().catch(() => {});
}

$("#finish-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const d = state.draft;
  if (!d) return;
  const btn = $("#finish-save");
  btn.disabled = true;
  btn.textContent = "Saving…";
  showError($("#finish-error"), "");
  const legendNotes = {};
  for (const input of document.querySelectorAll("[data-legend]")) legendNotes[input.dataset.legend] = input.value;
  try {
    const { trip } = await api("/api/trips", {
      method: "POST",
      body: {
        id: d.id,
        name: $("#finish-name").value,
        notes: $("#finish-notes").value,
        startedAt: d.startedAt,
        endedAt: Date.now(),
        segments: d.segments
          .filter((s) => s.path.length >= 2)
          .map(({ zoneTypeId, path, startedAt, endedAt }) => ({ zoneTypeId, path, startedAt, endedAt })),
        pins: d.pins,
        legendNotes,
        emailSummary: $("#finish-email").checked,
      },
    });
    $("#finish-dialog").close();
    discardDraft();
    toast($("#finish-email").checked ? "Trip saved. Summary is on its way to your inbox." : "Trip saved");
    location.hash = `#/trips/${trip.id}`;
  } catch (err) {
    showError(
      $("#finish-error"),
      err.network ? "No connection. Your trip is kept on this phone, so try again when you have signal." : err.message,
    );
  } finally {
    btn.disabled = false;
    btn.textContent = "Save trip";
  }
});

/* ---------- trips ---------- */

function zoneBar(legend, totals) {
  const total = Object.values(totals || {}).reduce((a, b) => a + b, 0);
  if (!total) return "";
  return `<div class="zone-bar">${legend
    .filter((l) => totals[l.zoneTypeId])
    .map((l) => `<span style="width:${((totals[l.zoneTypeId] / total) * 100).toFixed(2)}%;background:${esc(l.color)}" title="${esc(l.name)}"></span>`)
    .join("")}</div>`;
}

async function renderTrips() {
  const list = $("#trips-list");
  list.innerHTML = `<p class="muted">Loading…</p>`;
  try {
    const { trips } = await api("/api/trips");
    if (!trips.length) {
      list.innerHTML = `<div class="empty"><p>No trips yet. Take a drive and paint some streets.</p><a class="btn btn-primary" href="#/drive">Start a drive</a></div>`;
      return;
    }
    list.innerHTML = trips
      .map(
        (t) => `<a class="trip-card" href="#/trips/${esc(t.id)}">
          <h2>${esc(t.name)}</h2>
          <div class="trip-meta">${esc(fmtDate(t.startedAt))} · ${fmtMiles(t.distanceM)} · ${fmtDuration(t.endedAt - t.startedAt)}</div>
          ${zoneBar(t.legend, t.metersByZone)}
        </a>`,
      )
      .join("");
  } catch (err) {
    list.innerHTML = `<p class="form-error">${esc(err.message)}</p>`;
  }
}

function colorFor(zoneTypeId, legend) {
  return legend?.find((l) => l.zoneTypeId === zoneTypeId)?.color || zoneById(zoneTypeId)?.color || "#64748b";
}

/** Zooms to the layers, keeping them clear of the top bar and whichever sheet covers the map. */
function fitTo(layers) {
  const bounds = L.featureGroup(layers).getBounds();
  if (!bounds.isValid()) return;
  const topLeft = [40, 40 + 52];
  const bottomRight = [40, 40];
  const cover = state.view === "drive" ? $(".dock") : $("#view-panel");
  const r = cover?.getBoundingClientRect();
  if (r && r.height > 0 && !cover.classList.contains("collapsed")) {
    if (window.innerWidth >= 900 && cover.id === "view-panel") topLeft[0] = r.right + 24;
    else bottomRight[1] = window.innerHeight - r.top + 24;
  }
  map.fitBounds(bounds, { paddingTopLeft: topLeft, paddingBottomRight: bottomRight, maxZoom: 17 });
}

let currentTrip = null;

async function renderTrip(id) {
  const body = $("#panel-body");
  body.innerHTML = `<p class="muted">Loading…</p>`;
  viewLayer.clearLayers();
  try {
    currentTrip = await api(`/api/trips/${encodeURIComponent(id)}`);
  } catch (err) {
    body.innerHTML = `<p class="form-error">${esc(err.message)}</p><a href="#/trips">Back to trips</a>`;
    return;
  }
  const { trip, segments, pins } = currentTrip;
  const layers = segments.map((s) => L.polyline(s.path, lineStyle(colorFor(s.zoneTypeId, trip.legend))).addTo(viewLayer));
  const pinLayers = pins.map((p) => pinMarker(p, p.zoneTypeId ? colorFor(p.zoneTypeId, trip.legend) : null).addTo(viewLayer));
  renderTripPanel(false);
  fitTo([...layers, ...pinLayers]);
}

function renderTripPanel(editing) {
  const { trip, pins } = currentTrip;
  const body = $("#panel-body");
  const legendHtml = trip.legend
    .map(
      (l) => `<li>
        <span class="sw" style="background:${esc(l.color)}"></span>
        <div><b>${esc(l.name)}</b> <span class="muted small">· ${fmtMiles(trip.metersByZone[l.zoneTypeId] || 0)}</span></div>
        <div class="meaning">${esc(l.description)}</div>
        ${
          editing
            ? `<input class="trip-note" data-legend="${esc(l.zoneTypeId)}" maxlength="1000" value="${esc(l.tripNote)}" placeholder="What you saw on this trip">`
            : l.tripNote
              ? `<div class="trip-note">“${esc(l.tripNote)}”</div>`
              : ""
        }
      </li>`,
    )
    .join("");
  const pinsHtml = pins.length
    ? `<h3>Notes on the map (${pins.length})</h3><ul class="pin-list">${pins
        .map(
          (p, i) => `<li><button type="button" data-pin="${i}"><span class="sw" style="background:${esc(
            p.zoneTypeId ? colorFor(p.zoneTypeId, trip.legend) : "#475569",
          )}"></span><span>${esc(p.note || "(no text)")}</span></button></li>`,
        )
        .join("")}</ul>`
    : "";

  body.innerHTML = `
    <p class="small"><a href="#/trips">← All trips</a></p>
    ${editing ? `<label for="trip-name">Trip name</label><input id="trip-name" maxlength="120" value="${esc(trip.name)}">` : `<h2>${esc(trip.name)}</h2>`}
    <p class="stat-line">${esc(fmtDate(trip.startedAt))} · ${fmtMiles(trip.distanceM)} · ${fmtDuration(trip.endedAt - trip.startedAt)}</p>
    <h3>Key</h3>
    <ul class="legend">${legendHtml || `<li class="muted">Only notes on this trip.</li>`}</ul>
    <h3>Notes</h3>
    ${
      editing
        ? `<textarea id="trip-notes" rows="5" maxlength="10000">${esc(trip.notes)}</textarea>`
        : `<p style="white-space:pre-wrap;margin:0">${trip.notes ? esc(trip.notes) : `<span class="muted">No notes.</span>`}</p>`
    }
    ${pinsHtml}
    <p class="form-error" id="trip-error" hidden></p>
    <div class="row-actions">
      ${
        editing
          ? `<button class="btn btn-primary" type="button" id="trip-save">Save</button><button class="btn btn-ghost" type="button" id="trip-cancel">Cancel</button>`
          : `<button class="btn btn-ghost" type="button" id="trip-edit">Edit notes and key</button><button class="btn btn-danger-ghost" type="button" id="trip-delete">Delete trip</button>`
      }
    </div>`;

  body.querySelectorAll("[data-pin]").forEach((btn) =>
    btn.addEventListener("click", () => {
      const p = pins[Number(btn.dataset.pin)];
      map.setView([p.lat, p.lng], 18);
      L.popup().setLatLng([p.lat, p.lng]).setContent(esc(p.note || "(no text)")).openOn(map);
    }),
  );
  $("#trip-edit")?.addEventListener("click", () => renderTripPanel(true));
  $("#trip-cancel")?.addEventListener("click", () => renderTripPanel(false));
  $("#trip-delete")?.addEventListener("click", async () => {
    if (!confirm(`Delete "${trip.name}"? This can't be undone.`)) return;
    try {
      await api(`/api/trips/${trip.id}`, { method: "DELETE" });
      toast("Trip deleted");
      location.hash = "#/trips";
    } catch (err) {
      showError($("#trip-error"), err.message);
    }
  });
  $("#trip-save")?.addEventListener("click", async () => {
    const legendNotes = {};
    body.querySelectorAll("[data-legend]").forEach((i) => (legendNotes[i.dataset.legend] = i.value));
    try {
      const { trip: saved } = await api(`/api/trips/${trip.id}`, {
        method: "PATCH",
        body: { name: $("#trip-name").value, notes: $("#trip-notes").value, legendNotes },
      });
      currentTrip.trip = { ...trip, name: saved.name, notes: saved.notes, legend: saved.legend };
      renderTripPanel(false);
      toast("Saved");
    } catch (err) {
      showError($("#trip-error"), err.message);
    }
  });
}

/* ---------- my map (everything) ---------- */

const hiddenZones = new Set();
let showPins = true;
let mapData = null;

async function renderMyMap() {
  const body = $("#panel-body");
  body.innerHTML = `<p class="muted">Loading…</p>`;
  viewLayer.clearLayers();
  try {
    mapData = await api("/api/map");
  } catch (err) {
    body.innerHTML = `<p class="form-error">${esc(err.message)}</p>`;
    return;
  }
  drawMyMap(true);
}

function myMapZones() {
  const zones = new Map(state.zones.map((z) => [z.id, { id: z.id, name: z.name, color: z.color, description: z.description }]));
  for (const t of mapData.trips) {
    for (const l of t.legend) {
      if (!zones.has(l.zoneTypeId)) zones.set(l.zoneTypeId, { id: l.zoneTypeId, name: l.name, color: l.color, description: l.description });
    }
  }
  return [...zones.values()];
}

function drawMyMap(fit) {
  viewLayer.clearLayers();
  const tripsById = new Map(mapData.trips.map((t) => [t.id, t]));
  const totals = {};
  const layers = [];
  for (const s of mapData.segments) {
    totals[s.zoneTypeId] = (totals[s.zoneTypeId] || 0) + s.lengthM;
    if (hiddenZones.has(s.zoneTypeId)) continue;
    const trip = tripsById.get(s.tripId);
    const line = L.polyline(s.path, lineStyle(zoneById(s.zoneTypeId)?.color || colorFor(s.zoneTypeId, trip?.legend)));
    line.bindPopup(`<b>${esc(trip?.name || "Trip")}</b><br>${esc(fmtDate(trip?.startedAt || 0))}<br><a href="#/trips/${esc(s.tripId)}">Open trip</a>`);
    layers.push(line.addTo(viewLayer));
  }
  if (showPins) {
    for (const p of mapData.pins) {
      if (p.zoneTypeId && hiddenZones.has(p.zoneTypeId)) continue;
      layers.push(pinMarker(p, p.zoneTypeId ? zoneById(p.zoneTypeId)?.color || colorFor(p.zoneTypeId, tripsById.get(p.tripId)?.legend) : null).addTo(viewLayer));
    }
  }
  const zones = myMapZones().filter((z) => totals[z.id] || mapData.pins.some((p) => p.zoneTypeId === z.id));
  const body = $("#panel-body");
  body.innerHTML = mapData.segments.length || mapData.pins.length
    ? `<h2>My map</h2>
      <p class="stat-line">${mapData.trips.length} trip${mapData.trips.length === 1 ? "" : "s"} · ${fmtMiles(Object.values(totals).reduce((a, b) => a + b, 0))} painted</p>
      <h3>Key</h3>
      <ul class="legend">${zones
        .map(
          (z) => `<li><input type="checkbox" class="sr-only" id="zf-${esc(z.id)}" data-filter="${esc(z.id)}" ${hiddenZones.has(z.id) ? "" : "checked"}>
            <span class="sw" style="background:${esc(z.color)};${hiddenZones.has(z.id) ? "opacity:.25" : ""}"></span>
            <label class="check" for="zf-${esc(z.id)}">${esc(z.name)} <span class="muted small">· ${fmtMiles(totals[z.id] || 0)}</span></label>
            <div class="meaning">${esc(z.description)}</div></li>`,
        )
        .join("")}</ul>
      <p class="muted small">Tap a color to hide or show it.</p>
      <label class="check"><input type="checkbox" id="pins-toggle" ${showPins ? "checked" : ""}> Show notes (${mapData.pins.length})</label>`
    : `<div class="empty"><p>Your map is empty. Every street you paint shows up here.</p><a class="btn btn-primary" href="#/drive">Start a drive</a></div>`;

  body.querySelectorAll("[data-filter]").forEach((input) =>
    input.addEventListener("change", () => {
      if (input.checked) hiddenZones.delete(input.dataset.filter);
      else hiddenZones.add(input.dataset.filter);
      drawMyMap(false);
    }),
  );
  $("#pins-toggle")?.addEventListener("change", (e) => {
    showPins = e.target.checked;
    drawMyMap(false);
  });
  if (fit) fitTo(layers);
}

$("#panel-toggle").addEventListener("click", () => {
  const panel = $("#view-panel");
  panel.classList.toggle("collapsed");
  $("#panel-toggle").setAttribute("aria-expanded", String(!panel.classList.contains("collapsed")));
});

/* ---------- key (zone types) ---------- */

async function renderKey() {
  try {
    state.zones = (await api("/api/zones")).zones;
  } catch (err) {
    $("#zones-list").innerHTML = `<p class="form-error">${esc(err.message)}</p>`;
    return;
  }
  const pro = state.user.plan === "pro";
  $("#zones-list").innerHTML = state.zones
    .map((z) => {
      const editable = !z.locked;
      return `<form class="zone-card" data-zone-form="${esc(z.id)}">
        <div class="zone-card-head">
          <span class="sw" style="background:${esc(z.color)}"></span>
          <h2>${esc(z.name)}</h2>
          ${z.locked ? `<span class="plan-badge pro">Pro</span>` : ""}
        </div>
        ${
          pro
            ? `<div class="grid2">
                <div><label for="zn-${esc(z.id)}">Name</label><input id="zn-${esc(z.id)}" name="name" maxlength="40" value="${esc(z.name)}" required></div>
                <div><label for="zc-${esc(z.id)}">Color</label><input id="zc-${esc(z.id)}" name="color" type="color" value="${esc(z.color)}"></div>
              </div>`
            : ""
        }
        <label for="zd-${esc(z.id)}">What it means</label>
        <textarea id="zd-${esc(z.id)}" name="description" rows="3" maxlength="500" ${editable ? "" : "disabled"}>${esc(z.description)}</textarea>
        <p class="form-error" hidden></p>
        <div class="row-actions">
          ${editable ? `<button class="btn btn-primary" type="submit">Save</button>` : `<button class="btn btn-ghost" type="button" data-upgrade>Unlock with Pro</button>`}
          ${pro && !z.isDefault ? `<button class="btn btn-danger-ghost" type="button" data-delete-zone="${esc(z.id)}">Remove</button>` : ""}
        </div>
      </form>`;
    })
    .join("");

  $("#zone-add").innerHTML = pro
    ? `<form class="zone-card" id="zone-add-form" style="margin-top:1rem">
        <div class="zone-card-head"><h2>Add a zone</h2></div>
        <div class="grid2">
          <div><label for="za-name">Name</label><input id="za-name" name="name" maxlength="40" required placeholder="e.g. Outreach"></div>
          <div><label for="za-color">Color</label><input id="za-color" name="color" type="color" value="#7c3aed"></div>
        </div>
        <label for="za-desc">What it means</label>
        <textarea id="za-desc" name="description" rows="2" maxlength="500" placeholder="e.g. A community we want to reach out to"></textarea>
        <p class="form-error" hidden></p>
        <div class="row-actions"><button class="btn btn-primary" type="submit">Add zone</button></div>
      </form>`
    : `<div class="upsell">
        <h2><span class="sw" style="background:#7c3aed"></span>Want your own colors?</h2>
        <p>With Pro you can add zones for any use case, like <b>Purple: a community we want to reach out to</b>, and rename or recolor Green, Yellow and Red.</p>
        <button class="btn btn-primary" type="button" data-upgrade>See Pro features</button>
      </div>`;
}

$("#view-key").addEventListener("click", async (e) => {
  if (e.target.closest("[data-upgrade]")) return openUpgrade();
  const del = e.target.closest("[data-delete-zone]");
  if (del) {
    const zone = zoneById(del.dataset.deleteZone);
    if (!confirm(`Remove "${zone?.name}"? Trips you already painted keep this color.`)) return;
    try {
      await api(`/api/zones/${del.dataset.deleteZone}`, { method: "DELETE" });
      toast("Zone removed");
      await renderKey();
      renderDock();
    } catch (err) {
      toast(err.message);
    }
  }
});

$("#view-key").addEventListener("submit", async (e) => {
  e.preventDefault();
  const form = e.target;
  const errorEl = form.querySelector(".form-error");
  const fields = Object.fromEntries(new FormData(form));
  try {
    if (form.id === "zone-add-form") {
      await api("/api/zones", { method: "POST", body: fields });
      toast("Zone added. It's ready on the Drive screen.");
    } else {
      await api(`/api/zones/${form.dataset.zoneForm}`, { method: "PATCH", body: fields });
      toast("Key saved");
    }
    await renderKey();
    renderDock();
    renderDraft();
  } catch (err) {
    showError(errorEl, err.message);
  }
});

/* ---------- explore ---------- */

const explore = createExplore({
  map,
  api,
  esc,
  toast,
  openUpgrade,
  getZones: () => state.zones,
  getLastFix: () => state.lastFix,
});
$("#areas-btn").setAttribute("aria-pressed", String(explore.overlayOn()));
$("#areas-btn").addEventListener("click", () => {
  const on = !explore.overlayOn();
  explore.setOverlay(on);
  $("#areas-btn").setAttribute("aria-pressed", String(on));
  toast(on ? "Showing area scores from Explore" : "Area scores hidden");
});

/* ---------- routing ---------- */

const VIEWS = ["login", "drive", "trips", "panel", "key"];

function showView(name, tab) {
  for (const v of VIEWS) $(`#view-${v}`).hidden = v !== name;
  document.querySelectorAll(".tabs a").forEach((a) => a.classList.toggle("active", a.dataset.tab === tab));
  document.body.classList.toggle("drive-active", name === "drive");
  document.body.classList.toggle("panel-open", name === "panel");
  const driveShown = name === "drive";
  if (driveShown) map.addLayer(driveLayer);
  else map.removeLayer(driveLayer);
  if (name === "panel") map.addLayer(viewLayer);
  else map.removeLayer(viewLayer);
  $("#view-panel").classList.remove("collapsed");
  setTimeout(() => map.invalidateSize(), 0);
}

async function handleVerifyLink(query) {
  const params = new URLSearchParams(query);
  const email = params.get("email");
  const code = params.get("code");
  showView("login");
  if (!email || !code) return;
  pendingEmail = email;
  try {
    await signIn(email, code);
  } catch (err) {
    $("#login-email").value = email;
    showError($("#login-error"), err.message);
  }
}

function route() {
  const [path, query] = location.hash.replace(/^#/, "").split("?");
  const parts = path.split("/").filter(Boolean);

  if (parts[0] === "verify") return handleVerifyLink(query);
  renderAccount();
  if (parts[0] === "signin") {
    const upgrading = !!state.user?.isGuest;
    if (state.user && !upgrading) {
      location.hash = "#/drive";
      return;
    }
    explore.setContext(null);
    state.view = "login";
    $("#login-title").textContent = upgrading ? "Save your work" : "Green Zone";
    $("#login-intro").hidden = upgrading;
    $("#login-upgrade-note").hidden = !upgrading;
    $("#login-guest").hidden = upgrading;
    $("#login-back").hidden = !upgrading;
    return showView("login");
  }
  if (!state.user) {
    state.view = "login";
    explore.setContext(null);
    $("#login-title").textContent = "Green Zone";
    $("#login-intro").hidden = false;
    $("#login-upgrade-note").hidden = true;
    $("#login-guest").hidden = false;
    $("#login-back").hidden = true;
    return showView("login");
  }

  if (parts[0] !== "explore" && parts[0] !== "drive" && parts[0]) explore.setContext(null);

  switch (parts[0]) {
    case "explore":
      state.view = "explore";
      showView("panel", "explore");
      return explore.setContext("explore", parts[1] || null);
    case "trips":
      if (parts[1]) {
        state.view = "trip";
        showView("panel", "trips");
        return renderTrip(parts[1]);
      }
      state.view = "trips";
      showView("trips", "trips");
      return renderTrips();
    case "map":
      state.view = "map";
      showView("panel", "map");
      return renderMyMap();
    case "key":
      state.view = "key";
      showView("key", "key");
      return renderKey();
    default: {
      const wasDrive = state.view === "drive";
      state.view = "drive";
      showView("drive", "drive");
      explore.setContext("drive");
      renderDraft();
      renderDock();
      startGps();
      if (!wasDrive && state.follow && state.lastFix) map.setView([state.lastFix.lat, state.lastFix.lng], Math.max(map.getZoom(), 16));
      else if (!wasDrive && state.draft) fitTo(driveLayer.getLayers());
    }
  }
}

window.addEventListener("hashchange", route);

(async function boot() {
  try {
    await loadSession();
    if (state.user) carryDraft(null);
    // No account needed: first-time visitors go straight in as a guest.
    else if (!signedOutBefore() && !location.hash.startsWith("#/verify")) {
      await startGuest();
      if (state.user) toast("You're using Green Zone as a guest. Add your email from the menu to keep your work.", 5000);
    }
  } catch {
    state.user = null;
  }
  if (state.user && state.draft) toast("Your unfinished trip is still here. Tap a color to keep painting.", 4000);
  route();
})();

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("/sw.js").catch(() => {});
}
