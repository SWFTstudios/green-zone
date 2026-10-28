import assert from "node:assert/strict";
import { test } from "node:test";
import { PRESETS, METRICS, criterionScore, driveRatings, formatValue, metricByKey, scoreAreas } from "../public/areas-core.js";

test("presets only reference known metrics", () => {
  for (const [id, preset] of Object.entries(PRESETS)) {
    for (const c of preset.criteria) assert.ok(metricByKey(c.key), `${id} uses unknown metric ${c.key}`);
  }
  assert.equal(new Set(METRICS.map((m) => m.key)).size, METRICS.length, "metric keys are unique");
});

test("directional criteria rank against the set; ranges are absolute", () => {
  const sorted = [1, 2, 3, 4, 5];
  assert.equal(criterionScore({ mode: "higher" }, 5, sorted), 100);
  assert.equal(criterionScore({ mode: "higher" }, 1, sorted), 0);
  assert.equal(criterionScore({ mode: "lower" }, 1, sorted), 100);
  assert.equal(criterionScore({ mode: "higher" }, 3, sorted), 50);
  assert.equal(criterionScore({ mode: "higher", min: 4 }, 3, sorted), 0, "below a minimum scores 0");
  assert.equal(criterionScore({ mode: "range", min: 100, max: 200 }, 150, []), 100);
  assert.equal(criterionScore({ mode: "range", min: 100, max: 200 }, 250, []), 50);
  assert.equal(criterionScore({ mode: "range", min: 100, max: 200 }, 400, []), 0);
  assert.equal(criterionScore({ mode: "range" }, 150, []), null, "a range with no bounds doesn't score");
  assert.equal(criterionScore({ mode: "higher" }, null, sorted), null);
  assert.equal(criterionScore({ mode: "oneOf", oneOf: ["Residential"] }, "Residential", []), 100);
  assert.equal(criterionScore({ mode: "oneOf", oneOf: ["Residential"] }, "Industrial", []), 0);
});

test("scoreAreas colors by thresholds and must-haves", () => {
  const areas = [
    { geoid: "a", metrics: { grossYield: 0.09, vacancyRate: 0.03 } },
    { geoid: "b", metrics: { grossYield: 0.06, vacancyRate: 0.08 } },
    { geoid: "c", metrics: { grossYield: 0.03, vacancyRate: 0.2 } },
    { geoid: "d", metrics: { grossYield: null } },
    { geoid: "e", metrics: null },
  ];
  const criteria = [
    { key: "grossYield", mode: "higher", weight: 3 },
    { key: "vacancyRate", mode: "lower", weight: 1 },
  ];
  const r = scoreAreas(areas, criteria, { green: 67, red: 34 });
  assert.equal(r.get("a").color, "green");
  assert.equal(r.get("a").score, 100);
  assert.equal(r.get("b").color, "yellow");
  assert.equal(r.get("c").color, "red");
  assert.equal(r.get("d").color, "nodata");
  assert.equal(r.get("e").color, "pending");

  const strict = scoreAreas(areas, [...criteria, { key: "vacancyRate", mode: "lower", weight: 0, must: true, max: 0.05 }], { green: 67, red: 34 });
  assert.equal(strict.get("a").color, "green");
  assert.equal(strict.get("b").color, "fail");
  assert.deepEqual(strict.get("b").fails, ["vacancyRate"]);
});

test("formatting", () => {
  assert.equal(formatValue(metricByKey("zhvi"), 412345), "$412,345");
  assert.equal(formatValue(metricByKey("zori"), 1850), "$1,850/mo");
  assert.equal(formatValue(metricByKey("vacancyRate"), 0.0712), "7.1%");
  assert.equal(formatValue(metricByKey("ownerOccupiedRate"), 0.62), "62%");
  assert.equal(formatValue(metricByKey("myRating"), 40), "+40");
  assert.equal(formatValue(metricByKey("zhvi"), null), "—");
});

test("drive ratings weigh painted meters inside each area", () => {
  const sq = (w, s, e, n) => ({ type: "Polygon", coordinates: [[[w, s], [e, s], [e, n], [w, n], [w, s]]] });
  const areas = [
    { geoid: "A", geometry: sq(-75.2, 39.9, -75.1, 40), bounds: { w: -75.2, s: 39.9, e: -75.1, n: 40 } },
    { geoid: "B", geometry: sq(-75.1, 39.9, -75.0, 40), bounds: { w: -75.1, s: 39.9, e: -75.0, n: 40 } },
  ];
  const segments = [
    { zoneTypeId: "g", path: [[39.95, -75.19], [39.95, -75.17], [39.95, -75.15]] },
    { zoneTypeId: "r", path: [[39.95, -75.09], [39.95, -75.05]] },
    { zoneTypeId: "y", path: [[39.96, -75.09], [39.96, -75.05]] },
    { zoneTypeId: "custom", path: [[39.96, -75.19], [39.96, -75.15]] },
  ];
  const r = driveRatings(areas, segments, new Map([["g", 1], ["y", 0], ["r", -1]]));
  assert.equal(r.get("A").rating, 100);
  assert.equal(r.get("B").rating, -50);
});

test("overlay colors follow the ramp between the 5th and 95th percentile", async () => {
  const { OVERLAYS, overlayColors, rampColor, overlayById } = await import("../public/areas-core.js");
  assert.equal(rampColor(["#000000", "#ffffff"], 0), "#000000");
  assert.equal(rampColor(["#000000", "#ffffff"], 1), "#ffffff");
  assert.equal(rampColor(["#000000", "#ffffff"], 0.5), "#808080");
  assert.equal(rampColor(["#000000", "#ff0000", "#ffffff"], 0.75), "#ff8080");
  const night = overlayById("nightLight");
  const areas = Array.from({ length: 21 }, (_, i) => ({ geoid: String(i), metrics: { nightLight: i * 5 } }));
  areas.push({ geoid: "none", metrics: { nightLight: null } }, { geoid: "pending", metrics: null });
  const { colors, min, max, count } = overlayColors(areas, night);
  assert.equal(count, 21);
  assert.equal(min, 5);
  assert.equal(max, 95);
  assert.equal(colors.get("0"), night.ramp[0]);
  assert.equal(colors.get("20"), night.ramp[night.ramp.length - 1]);
  assert.ok(!colors.has("none") && !colors.has("pending"));
  for (const o of OVERLAYS) if (o.metric) assert.ok(metricByKey(o.metric), `${o.id} uses a known metric`);
});
