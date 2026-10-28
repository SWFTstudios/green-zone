/* The in-app guide (with the full map key) and the first-run tour. */
import { OVERLAYS } from "./areas-core.js";

const AREA_COLORS = { green: "#16a34a", yellow: "#eab308", red: "#dc2626", nodata: "#9ca3af", pending: "#cbd5e1" };
const TOUR_KEY = "gz_tour_done";

/* ---------- guide page ---------- */

export function renderGuide(el, { esc, zones = [], isGuest = false }) {
  const painted = zones
    .map(
      (z) => `<tr><td><span class="key-line" style="background:${esc(z.color)}"></span></td>
        <td><b>${esc(z.name)}${z.locked ? " (Pro)" : ""}</b>${esc(z.description || "")}</td></tr>`,
    )
    .join("");
  const layers = OVERLAYS.filter((o) => o.ramp)
    .map(
      (o) => `<tr><td><span class="key-ramp" style="background:linear-gradient(90deg,${o.ramp.join(",")})"></span></td>
        <td><b>${esc(o.label)}</b>${esc(o.source)}${o.domain ? "" : ". Pale to dark across the areas on screen."}</td></tr>`,
    )
    .join("");
  el.innerHTML = `
    <div class="page-head"><h1>How to use Green Zone</h1></div>
    <p class="muted">Paint the streets you drive green, yellow or red, then score every neighborhood with public data. Here's everything in one place.</p>
    <div class="guide-actions">
      <button class="btn btn-primary" type="button" data-start-tour>Take the 1-minute tour</button>
      <a class="btn btn-ghost" href="#/drive">Start a drive</a>
      <button class="btn btn-ghost" type="button" data-review>Leave a review</button>
    </div>
    <nav class="guide-toc" aria-label="Guide sections">
      <a href="#/guide?s=drive">Driving</a><a href="#/guide?s=map-key">Map key</a><a href="#/guide?s=explore">Explore</a>
      <a href="#/guide?s=trips">Trips &amp; notes</a><a href="#/guide?s=key">Your key &amp; Pro</a><a href="#/guide?s=account">Your account</a><a href="#/guide?s=tips">Tips</a>
    </nav>

    <h2 id="g-drive">Driving</h2>
    <ol>
      <li>Open <b>Drive</b> and allow location when your phone asks.</li>
      <li>Tap <b>Green</b>, <b>Yellow</b> or <b>Red</b>. The street you're on is painted that color as you move.</li>
      <li>Tap a different color when the block changes. Tap the same color again, or <b>Pause</b>, to stop painting.</li>
      <li><b>Add note</b> drops a pin where you are, like “vacant, overgrown yard, 412 Maple”. <b>Undo</b> removes the last stretch.</li>
      <li><b>Finish trip</b> lets you name the drive, write what each color meant on this trip, add notes, and email yourself a summary.</li>
    </ol>
    <p><b>✎ Draw mode</b> paints without driving: tap it, pick a color, then tap along streets. <b>◎</b> keeps the map following you; drag the map to look around and tap it again to come back.</p>
    <p class="tip">Your trip is saved on this phone as you go, so a dead zone, a refresh or a closed tab doesn't lose it.</p>

    <h2 id="g-map-key">Map key</h2>
    <p>Lines are what you painted. Shaded neighborhoods are what the data says, using your criteria in Explore.</p>
    <h3>Streets you painted</h3>
    <table class="key-table">${painted}
      <tr><td><span class="key-icon">📍</span></td><td><b>Pins</b>Notes you dropped on a drive. Tap one to read it.</td></tr>
    </table>
    <h3>Neighborhood colors</h3>
    <table class="key-table">
      <tr><td><span class="key-fill" style="border-color:${AREA_COLORS.green};background:${AREA_COLORS.green}66"></span></td><td><b>Green</b>Scores at or above your green line (67 out of 100 unless you change it).</td></tr>
      <tr><td><span class="key-fill" style="border-color:${AREA_COLORS.yellow};background:${AREA_COLORS.yellow}66"></span></td><td><b>Yellow</b>Between your red and green lines.</td></tr>
      <tr><td><span class="key-fill" style="border-color:${AREA_COLORS.red};background:${AREA_COLORS.red}66"></span></td><td><b>Red</b>Below your red line (34 unless you change it).</td></tr>
      <tr><td><span class="key-fill dashed" style="border-color:${AREA_COLORS.red};background:transparent"></span></td><td><b>Dashed outline</b>Misses one of your must-haves. You can hide these instead.</td></tr>
      <tr><td><span class="key-fill" style="border-color:${AREA_COLORS.nodata};background:${AREA_COLORS.nodata}66"></span></td><td><b>Gray</b>Not enough data to score with your criteria.</td></tr>
      <tr><td><span class="key-fill" style="border-color:${AREA_COLORS.pending};background:${AREA_COLORS.pending}44"></span></td><td><b>Faint</b>Still loading. It fills in by itself.</td></tr>
    </table>
    <p class="muted small">Scores rank each area against the others on screen, so the same area can change color as you move the map.</p>
    <h3>Layers</h3>
    <p>Open the layers button to color neighborhoods by a single measure instead of your criteria. The legend at the bottom of the map shows the range.</p>
    <table class="key-table">${layers}
      <tr><td><span class="key-icon">🌃</span></td><td><b>Night lights imagery</b>NASA's satellite photo of the area at night.</td></tr>
      <tr><td><span class="key-icon">🌊</span></td><td><b>Flood zones imagery</b>FEMA's 100-year floodplain, drawn in blue. Zoom in to see it.</td></tr>
    </table>
    <h3>Map buttons</h3>
    <table class="key-table">
      <tr><td><span class="key-icon"><span class="fab-mini">≋</span></span></td><td><b>Layers</b>Map, Light or Satellite, neighborhood colors, imagery and color strength.</td></tr>
      <tr><td><span class="key-icon"><span class="fab-mini">3D</span></span></td><td><b>3D</b>Tilts the map and raises buildings. Two-finger drag (or right-click drag) also tilts and rotates.</td></tr>
      <tr><td><span class="key-icon"><span class="fab-mini">▲</span></span></td><td><b>Compass</b>Tap to point north again.</td></tr>
    </table>

    <h2 id="g-explore">Explore</h2>
    <ol>
      <li>Search for a city, neighborhood or address, or tap ◎ to go to where you are. Zoom in until the neighborhoods fill in.</li>
      <li>Pick a <b>preset</b> (Balanced investor, Cash-flow rentals, Appreciation, Fix and flip, Active and well lit, Single-family) or build your own.</li>
      <li>For each criterion choose how much it matters, which way is better (higher, lower, or within a range), and whether it's a <b>must-have</b>.</li>
      <li>Drag the green and red lines to decide how strict the colors are.</li>
      <li>Tap any neighborhood for its score breakdown and every number behind it.</li>
      <li><b>Save search</b> keeps the criteria, the map view and a snapshot of the results. Reopen it from <b>Saved searches</b>.</li>
    </ol>
    <p>Streets you painted feed the <b>Your drive ratings</b> criterion: +100 if all green, −100 if all red. Open <b>About this data</b> at the bottom of Explore for every source.</p>

    <h2 id="g-trips">Trips, notes and summaries</h2>
    <p><b>Trips</b> lists every drive with its color breakdown. Open one to see it on the map with its key, edit the name and notes, or delete it. <b>My map</b> shows everything you've ever painted, with miles per color and filters.</p>

    <h2 id="g-key">Your key and Pro</h2>
    <p>The <b>Key</b> page explains what each color means to you. It's shown with every trip and in summary emails. With <b>Pro</b> you can rename and recolor Green, Yellow and Red, and add up to 24 zones of your own, like <i>Purple: a community we want to reach out to</i>.</p>

    <h2 id="g-account">Your account</h2>
    ${
      isGuest
        ? `<p>You're using Green Zone as a <b>guest</b>. Everything works, and it's saved in this browser. Choose <b>Save my work with email</b> from the menu (top right) to keep it and use it on any device. If that email already has an account, your guest work moves into it.</p>`
        : `<p>You sign in with a 6-digit code sent to your email, with no password. Your trips, key and saved searches follow you to any device.</p>`
    }

    <h2 id="g-tips">Tips</h2>
    <ul>
      <li>Let a passenger tap the buttons, or pull over first.</li>
      <li>Describe what you can see (property condition, vacant or boarded-up houses, traffic, whether it's comfortable to walk) rather than who lives there.</li>
      <li>Install it like an app: in your browser's share or menu, choose <b>Add to Home Screen</b>.</li>
      <li>Long drive? Plug in. GPS and an awake screen use battery.</li>
    </ul>
    <p class="muted small">Questions or ideas? <button type="button" class="btn-inline" data-review>Leave a review</button> and the team will read it. <a href="/">About Green Zone</a></p>`;
}

/* ---------- first-run tour ---------- */

function steps(isGuest) {
  return [
    {
      route: "#/drive",
      title: "Welcome to Green Zone",
      body: "Paint the streets you drive green, yellow or red, then score every neighborhood with public data. This quick tour shows you where everything is.",
    },
    {
      route: "#/drive",
      target: "#zone-buttons",
      title: "Tap a color to paint",
      body: "Tap Green, Yellow or Red and the street you're on is painted that color as you drive. Tap another color when the block changes.",
    },
    {
      route: "#/drive",
      target: ".dock-actions",
      title: "Pause, note, undo, finish",
      body: "Add note drops a pin where you are. Finish trip lets you name the drive, describe each color and email yourself a summary.",
    },
    {
      route: "#/drive",
      target: "#draw-btn",
      title: "Not driving? Draw instead",
      body: "Tap ✎, pick a color, then tap along streets to paint areas you already know.",
    },
    {
      route: "#/explore",
      target: '.tabs a[data-tab="explore"]',
      title: "Explore every neighborhood",
      body: "Each neighborhood on screen is colored by your criteria: rents, values, vacancy, flood risk, activity and more. Tap one to see every number behind it.",
    },
    {
      route: "#/explore",
      target: "#layers-btn",
      title: "Layers, satellite and 3D",
      body: "Switch the map type, color neighborhoods by one measure like flood risk, or turn on night lights and FEMA flood zones. The 3D button tilts the map.",
    },
    {
      route: "#/drive",
      target: '.tabs a[data-tab="key"]',
      title: "Make the colors yours",
      body: "On the Key page, write what each color means to you. It's shown with every trip.",
    },
    {
      route: "#/drive",
      target: "#account-btn",
      title: isGuest ? "Keep your work" : "Help is always here",
      body: isGuest
        ? "You're a guest, so your work is saved in this browser. Add your email here any time to keep it on every device. The guide, this tour and reviews are here too."
        : "The guide, this tour and a place to leave a review are all in this menu.",
    },
  ];
}

export function tourDone() {
  try {
    return !!localStorage.getItem(TOUR_KEY);
  } catch {
    return true;
  }
}

/** Runs the tour. `navigate(hash)` switches views; each step waits briefly for its target to appear. */
export function startTour({ isGuest = false, navigate }) {
  const root = document.querySelector("#tour");
  const spot = document.querySelector("#tour-spot");
  const card = document.querySelector("#tour-card");
  if (!root || !root.hidden) return;
  const list = steps(isGuest);
  let i = 0;
  let target = null;

  const finish = () => {
    root.hidden = true;
    removeEventListener("resize", place);
    document.removeEventListener("keydown", onKey);
    try {
      localStorage.setItem(TOUR_KEY, String(Date.now()));
    } catch {
      /* not critical */
    }
  };

  function place() {
    const r = target?.getBoundingClientRect();
    const visible = r && r.width > 0 && r.height > 0;
    spot.classList.toggle("none", !visible);
    const cw = card.offsetWidth;
    const ch = card.offsetHeight;
    if (!visible) {
      card.style.left = `${Math.max(12, (innerWidth - cw) / 2)}px`;
      card.style.top = `${Math.max(12, (innerHeight - ch) / 2)}px`;
      return;
    }
    const pad = 6;
    Object.assign(spot.style, { left: `${r.left - pad}px`, top: `${r.top - pad}px`, width: `${r.width + pad * 2}px`, height: `${r.height + pad * 2}px` });
    const below = r.bottom + pad + 12;
    const above = r.top - pad - 12 - ch;
    const top = below + ch < innerHeight - 8 ? below : above > 8 ? above : Math.max(8, innerHeight - ch - 8);
    const left = Math.min(innerWidth - cw - 12, Math.max(12, r.left + r.width / 2 - cw / 2));
    card.style.top = `${top}px`;
    card.style.left = `${left}px`;
  }

  async function show() {
    const step = list[i];
    if (step.route && location.hash.split("?")[0] !== step.route) navigate(step.route);
    target = null;
    if (step.target) {
      // Views render asynchronously; give the target a moment to show up.
      for (let tries = 0; tries < 20 && !target; tries++) {
        const el = document.querySelector(step.target);
        if (el && el.getBoundingClientRect().width > 0) target = el;
        else await new Promise((r) => setTimeout(r, 100));
      }
    }
    const last = i === list.length - 1;
    card.innerHTML = `
      <div class="tour-step">${i + 1} of ${list.length}</div>
      <h2 id="tour-title">${step.title}</h2>
      <p>${step.body}</p>
      <div class="tour-actions">
        <span class="tour-dots">${list.map((_, j) => `<i class="${j === i ? "on" : ""}"></i>`).join("")}</span>
        ${last ? "" : `<button type="button" class="btn btn-link" data-tour="skip" style="width:auto;margin:0">Skip</button>`}
        ${i ? `<button type="button" class="btn btn-ghost" data-tour="back">Back</button>` : ""}
        <button type="button" class="btn btn-primary" data-tour="next">${last ? "Done" : "Next"}</button>
      </div>`;
    place();
    card.querySelector('[data-tour="next"]').focus();
  }

  function onKey(e) {
    if (e.key === "Escape") finish();
    else if (e.key === "ArrowRight") card.querySelector('[data-tour="next"]')?.click();
    else if (e.key === "ArrowLeft") card.querySelector('[data-tour="back"]')?.click();
  }

  card.onclick = (e) => {
    const action = e.target.closest("[data-tour]")?.dataset.tour;
    if (action === "skip") finish();
    else if (action === "back" && i > 0) {
      i--;
      show();
    } else if (action === "next") {
      if (i === list.length - 1) finish();
      else {
        i++;
        show();
      }
    }
  };
  root.hidden = false;
  addEventListener("resize", place);
  document.addEventListener("keydown", onKey);
  show();
}
