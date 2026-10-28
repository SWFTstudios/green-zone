// Landing page: the scoring demo, scroll effects, returning-user buttons and the review popup.
import { scoreAreas } from "/areas-core.js";
import { bindReviewButtons } from "/review.js";

document.documentElement.classList.add("js");
const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;

/* ---------- scoring demo: the app's own scoring over made-up neighborhoods ---------- */

const SAMPLE = [
  ["Maple Hill", 0.071, 0.0, 0.79, 0.052, 0.04],
  ["Riverside", 0.083, 0.42, 0.7, 0.031, 0.07],
  ["Old Town", 0.058, 0.05, 0.84, 0.068, 0.05],
  ["Mill Park", 0.094, 0.12, 0.66, 0.012, 0.13],
  ["Cedar Row", 0.066, 0.0, 0.75, 0.044, 0.06],
  ["Harbor Point", 0.077, 0.61, 0.73, 0.058, 0.08],
  ["Northgate", 0.088, 0.03, 0.68, 0.027, 0.11],
  ["Elm Square", 0.052, 0.0, 0.86, 0.071, 0.03],
  ["Brookside", 0.069, 0.28, 0.77, 0.039, 0.05],
  ["Foundry", 0.101, 0.08, 0.62, -0.006, 0.17],
  ["Lakeview", 0.061, 0.19, 0.81, 0.063, 0.04],
  ["Station Hill", 0.079, 0.02, 0.72, 0.048, 0.09],
].map(([name, grossYield, floodShare, activeAdults, zhviYoY, vacancyRate], i) => ({
  geoid: String(i),
  name,
  metrics: { grossYield, floodShare, activeAdults, zhviYoY, vacancyRate },
}));

const CONTROLS = [
  { key: "grossYield", mode: "higher", label: "Rent yield", weight: 4 },
  { key: "floodShare", mode: "lower", label: "Low flood risk", weight: 3 },
  { key: "activeAdults", mode: "higher", label: "Active neighbors", weight: 2 },
  { key: "zhviYoY", mode: "higher", label: "Price growth", weight: 2 },
  { key: "vacancyRate", mode: "lower", label: "Low vacancy", weight: 3 },
];
const LEVELS = ["Ignore", "Minor", "Some", "Important", "Very important", "Critical"];
const COLORS = { green: "#16a34a", yellow: "#eab308", red: "#dc2626", nodata: "#9ca3af" };

function initScorer() {
  const controls = document.getElementById("scorer-controls");
  const grid = document.getElementById("scorer-grid");
  if (!controls || !grid) return;
  controls.innerHTML = CONTROLS.map(
    (c, i) => `<label>${c.label}<output id="sc-out-${i}">${LEVELS[c.weight]}</output>
      <input type="range" min="0" max="5" step="1" value="${c.weight}" data-i="${i}" aria-label="${c.label} importance"></label>`,
  ).join("");
  const render = () => {
    const results = scoreAreas(SAMPLE, CONTROLS.map(({ key, mode, weight }) => ({ key, mode, weight })), { green: 67, red: 34 });
    grid.innerHTML = SAMPLE.map((a) => {
      const r = results.get(a.geoid);
      return `<div class="cell" style="--c:${COLORS[r.color] || COLORS.nodata}"><b>${r.score ?? "—"}</b><span>${a.name}</span></div>`;
    }).join("");
  };
  controls.addEventListener("input", (e) => {
    const i = Number(e.target.dataset.i);
    if (!Number.isInteger(i)) return;
    CONTROLS[i].weight = Number(e.target.value);
    document.getElementById(`sc-out-${i}`).textContent = LEVELS[CONTROLS[i].weight];
    render();
  });
  render();
}

/* ---------- scroll effects ---------- */

function initScroll() {
  const nav = document.getElementById("nav");
  const sticky = document.getElementById("sticky-cta");
  const hero = document.querySelector(".hero");
  const final = document.querySelector(".final");
  let heroVisible = true;
  let finalVisible = false;
  const update = () => sticky.classList.toggle("show", !heroVisible && !finalVisible);
  new IntersectionObserver(([e]) => { heroVisible = e.isIntersecting; update(); }, { rootMargin: "-40% 0px 0px 0px" }).observe(hero);
  new IntersectionObserver(([e]) => { finalVisible = e.isIntersecting; update(); }).observe(final);

  const onScroll = () => nav.classList.toggle("scrolled", scrollY > 8);
  addEventListener("scroll", onScroll, { passive: true });
  onScroll();

  const reveals = document.querySelectorAll(".reveal");
  if (reduceMotion || !("IntersectionObserver" in window)) {
    reveals.forEach((el) => el.classList.add("seen"));
    return;
  }
  const io = new IntersectionObserver(
    (entries) =>
      entries.forEach((e) => {
        if (!e.isIntersecting) return;
        // Stagger siblings that come into view together.
        const siblings = [...e.target.parentElement.children].filter((c) => c.classList.contains("reveal"));
        e.target.style.transitionDelay = `${Math.min(siblings.indexOf(e.target), 5) * 60}ms`;
        e.target.classList.add("seen");
        io.unobserve(e.target);
      }),
    { rootMargin: "0px 0px -8% 0px" },
  );
  reveals.forEach((el) => io.observe(el));
}

/* ---------- returning users: "Open the app" instead of "Try it" ---------- */

function initReturning() {
  let returning = false;
  try {
    returning = Object.keys(localStorage).some((k) => k.startsWith("gz_"));
  } catch {
    return;
  }
  if (!returning) return;
  document.querySelectorAll(".hero [data-start], .final [data-start], .sticky-cta [data-start]").forEach((a) => {
    const arrow = a.querySelector("[aria-hidden]");
    a.textContent = arrow ? "Open the app " : "Open the app";
    if (arrow) a.append(arrow);
  });
}

initScorer();
initScroll();
initReturning();
bindReviewButtons({ source: "landing" });
