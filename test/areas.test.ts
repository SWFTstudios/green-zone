import assert from "node:assert/strict";
import { test } from "node:test";
import { parseAcsResponse, acsUrl, ACS_VARIABLES } from "../src/areas/acs.ts";
import { type AreaGeometry, findContaining, geometryBBox, parseBBox, pointInGeometry, roundGeometry, tileBBox, tilesFor } from "../src/areas/geo.ts";
import { sampleNightLights, tileUrl, tileXY, tilesForBBox } from "../src/areas/nightlights.ts";
import { aggregateOsm, countElement, emptyCounts, landUseSummary } from "../src/areas/osm.ts";
import { parsePlaces, placesUrl } from "../src/areas/places.ts";
import { ZILLOW_DATASETS, ZillowCsvParser, buildUpserts, parseCsvLine } from "../src/areas/zillowCsv.ts";

const square = (w: number, s: number, e: number, n: number): AreaGeometry => ({
  type: "Polygon",
  coordinates: [[[w, s], [e, s], [e, n], [w, n], [w, s]]],
});

test("point in polygon respects holes and multipolygons", () => {
  const donut: AreaGeometry = {
    type: "Polygon",
    coordinates: [
      [[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]],
      [[4, 4], [6, 4], [6, 6], [4, 6], [4, 4]],
    ],
  };
  assert.equal(pointInGeometry(1, 1, donut), true);
  assert.equal(pointInGeometry(5, 5, donut), false);
  assert.equal(pointInGeometry(11, 5, donut), false);
  const multi: AreaGeometry = { type: "MultiPolygon", coordinates: [square(0, 0, 1, 1).coordinates as never, square(5, 5, 6, 6).coordinates as never] };
  assert.equal(pointInGeometry(5.5, 5.5, multi), true);
  assert.equal(pointInGeometry(3, 3, multi), false);
  assert.deepEqual(geometryBBox(multi), { w: 0, s: 0, e: 6, n: 6 });
});

test("bbox parsing, tiles and rounding", () => {
  assert.deepEqual(parseBBox("-75.2,39.9,-75.1,40"), { w: -75.2, s: 39.9, e: -75.1, n: 40 });
  assert.equal(parseBBox("1,2,3"), null);
  assert.equal(parseBBox("5,0,1,1"), null);
  assert.equal(parseBBox("-200,0,1,1"), null);
  const tiles = tilesFor({ w: -75.25, s: 39.95, e: -75.05, n: 40.05 }, 0.1);
  assert.equal(tiles.length, 3 * 2);
  const b = tileBBox(tiles[0]);
  assert.ok(Math.abs(b.e - b.w - 0.1) < 1e-9);
  const rounded = roundGeometry({ type: "Polygon", coordinates: [[[1.123456789, 2.1], [1.123459, 2.1], [3, 4], [1.123456789, 2.1]]] });
  assert.deepEqual(rounded.coordinates[0][0], [1.12346, 2.1]);
  assert.equal((rounded.coordinates[0] as unknown[]).length, 3, "consecutive duplicates after rounding are dropped");
});

test("findContaining picks the right area", () => {
  const areas = [
    { id: "a", geometry: square(0, 0, 1, 1), bbox: { w: 0, s: 0, e: 1, n: 1 } },
    { id: "b", geometry: square(1, 0, 2, 1), bbox: { w: 1, s: 0, e: 2, n: 1 } },
  ];
  assert.equal(findContaining(areas, 1.5, 0.5)?.id, "b");
  assert.equal(findContaining(areas, 3, 3), null);
});

test("ACS response parsing handles sentinels and shares", () => {
  const vars = Object.values(ACS_VARIABLES);
  const header = ["NAME", ...vars, "state", "county", "tract"];
  const value = (key: keyof typeof ACS_VARIABLES, v: string, row: string[]) => {
    row[header.indexOf(ACS_VARIABLES[key])] = v;
  };
  const row = header.map(() => "0");
  row[0] = "Census Tract 1";
  value("population", "4000", row);
  value("medianHomeValue", "250000", row);
  value("medianRent", "-666666666", row);
  value("unitsTotal", "2000", row);
  value("unitsVacant", "200", row);
  value("occupied", "1800", row);
  value("ownerOccupied", "1200", row);
  value("medianYearBuilt", "1952", row);
  value("structTotal", "2000", row);
  value("sfDetached", "1000", row);
  value("sfAttached", "500", row);
  value("units2", "100", row);
  value("units3to4", "100", row);
  value("units50plus", "300", row);
  row[header.indexOf("state")] = "42";
  row[header.indexOf("county")] = "101";
  row[header.indexOf("tract")] = "000100";
  const out = parseAcsResponse([header, row]);
  const m = out["42101000100"];
  assert.ok(m);
  assert.equal(m.population, 4000);
  assert.equal(m.medianRent, null, "negative sentinel becomes null");
  assert.equal(m.vacancyRate, 0.1);
  assert.equal(m.ownerOccupiedRate, 0.6667);
  assert.equal(m.renterRate, 0.3333);
  assert.equal(m.pctSingleFamily, 0.75);
  assert.equal(m.pctSmallMulti, 0.1);
  assert.equal(m.pctLargeMulti, 0.15);
  assert.equal(m.medianYearBuilt, 1952);
  assert.match(acsUrl("https://api.census.gov/data/", "2024", "42101", "k&x"), /\/2024\/acs\/acs5\?get=NAME,B01003_001E.*&for=tract:\*&in=state:42%20county:101&key=k%26x$/);
  for (const forbidden of ["B02001", "B03002", "B05002", "B18101", "B11001"]) {
    assert.ok(!vars.some((v) => v.startsWith(forbidden)), `no protected-class table ${forbidden}`);
  }
});

test("OSM elements are classified and bucketed by area", () => {
  const c = emptyCounts();
  countElement(c, { type: "way", tags: { highway: "residential", lit: "yes" } });
  countElement(c, { type: "node", tags: { highway: "street_lamp" } });
  countElement(c, { type: "way", tags: { highway: "footway", lit: "yes" } });
  countElement(c, { type: "way", tags: { leisure: "park" } });
  countElement(c, { type: "node", tags: { leisure: "fitness_station" } });
  countElement(c, { type: "node", tags: { shop: "supermarket" } });
  countElement(c, { type: "node", tags: { shop: "hardware" } });
  countElement(c, { type: "node", tags: { highway: "bus_stop" } });
  countElement(c, { type: "way", tags: { landuse: "residential" } });
  countElement(c, { type: "way", tags: { landuse: "residential" } });
  countElement(c, { type: "way", tags: { landuse: "industrial" } });
  assert.equal(c.litWays, 2);
  assert.equal(c.streetLamps, 1);
  assert.equal(c.paths, 1);
  assert.equal(c.parks, 1);
  assert.equal(c.fitness, 1);
  assert.equal(c.grocery, 1);
  assert.equal(c.shops, 1);
  assert.equal(c.transit, 1);
  assert.deepEqual(landUseSummary(c.landuse), { dominant: "Residential", mix: { Residential: 2, Industrial: 1 } });

  const areas = [
    { geoid: "A", geometry: square(0, 0, 1, 1), bbox: { w: 0, s: 0, e: 1, n: 1 } },
    { geoid: "B", geometry: square(1, 0, 2, 1), bbox: { w: 1, s: 0, e: 2, n: 1 } },
  ];
  const agg = aggregateOsm(
    [
      { type: "node", lat: 0.5, lon: 0.5, tags: { leisure: "playground" } },
      { type: "way", center: { lat: 0.5, lon: 1.5 }, tags: { leisure: "park" } },
      { type: "node", lat: 5, lon: 5, tags: { leisure: "park" } },
    ],
    areas,
  );
  assert.equal(agg.get("A")!.playgrounds, 1);
  assert.equal(agg.get("B")!.parks, 1);
});

test("CSV line parsing handles quotes and commas", () => {
  assert.deepEqual(parseCsvLine('1,"New York, NY","He said ""hi""",,x'), ["1", "New York, NY", 'He said "hi"', "", "x"]);
});

test("Zillow parser keeps latest value and 12-month change", () => {
  const months = Array.from({ length: 14 }, (_, i) => {
    const d = new Date(Date.UTC(2025, i, 31));
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-28`;
  });
  const p = new ZillowCsvParser();
  p.pushLine(`RegionID,SizeRank,RegionName,RegionType,StateName,State,City,Metro,CountyName,${months.join(",")}`);
  assert.equal(p.month, months[13].slice(0, 7));
  const values = Array.from({ length: 14 }, (_, i) => String(100000 + i * 1000));
  const row = p.pushLine(`1,2,1001,zip,MA,MA,Agawam,"Springfield, MA",Hampden County,${values.join(",")}\r`);
  assert.ok(row);
  assert.equal(row.zip, "01001");
  assert.equal(row.metro, "Springfield, MA");
  assert.equal(row.value, 113000);
  assert.equal(Math.round(row.yoy! * 10000) / 10000, Math.round((113000 / 101000 - 1) * 10000) / 10000);
  const sparse = p.pushLine(`2,3,19103,zip,PA,PA,Philadelphia,"Philadelphia, PA",Philadelphia County,${values.slice(0, 13).join(",")},`);
  assert.equal(sparse!.value, 112000, "falls back to the newest month with data");
  assert.equal(p.pushLine(`3,4,abc,zip,PA,PA,X,Y,Z,${values.join(",")}`), null);
  assert.equal(p.pushLine(""), null);
});

test("Zillow upserts escape text and split by size", () => {
  const ds = ZILLOW_DATASETS.find((d) => d.id === "zhvi_all")!;
  const rows = Array.from({ length: 50 }, (_, i) => ({
    zip: String(10000 + i),
    state: "ID",
    city: "Coeur d'Alene",
    metro: "Coeur d'Alene, ID'); DROP TABLE users; --",
    county: "Kootenai County",
    value: 400000.456,
    yoy: 0.051234567,
  }));
  const stmts = buildUpserts(ds, rows, "2026-09", 1, 2000);
  assert.ok(stmts.length > 1, "splits into several statements");
  for (const s of stmts) {
    assert.ok(s.length <= 2600);
    assert.match(s, /^INSERT INTO zip_market \(zip, state, city, metro, county, zhvi, zhvi_yoy, zhvi_month, updated_at\) VALUES /);
    assert.match(s, /ON CONFLICT\(zip\) DO UPDATE SET/);
    assert.ok(!/[^']'\);/.test(s.replace(/''/g, "")), "quotes are doubled");
  }
  assert.match(stmts[0], /'Coeur d''Alene'/);
  assert.match(stmts[0], /400000\.46, 0\.05123, '2026-09', 1\)/);
  const total = stmts.join("").match(/\('1\d{4}'/g)!.length;
  assert.equal(total, 50);
});

test("ACS commute shares exclude people who work from home", () => {
  const vars = Object.values(ACS_VARIABLES);
  const header = ["NAME", ...vars, "state", "county", "tract"];
  const row = header.map(() => "0");
  const set = (key: keyof typeof ACS_VARIABLES, v: string) => (row[header.indexOf(ACS_VARIABLES[key])] = v);
  set("commuters", "1000");
  set("workFromHome", "200");
  set("commuteWalk", "60");
  set("commuteBike", "20");
  set("commuteTransit", "240");
  row[header.indexOf("state")] = "36";
  row[header.indexOf("county")] = "061";
  row[header.indexOf("tract")] = "000100";
  const m = parseAcsResponse([header, row])["36061000100"];
  assert.equal(m.walkBikeRate, 0.1);
  assert.equal(m.transitRate, 0.3);
  assert.equal(m.workFromHomeRate, 0.2);
});

test("CDC PLACES rows turn inactivity into an active-adults share", () => {
  const out = parsePlaces([
    { locationname: "36061000100", measureid: "LPA", data_value: "22.5" },
    { locationname: "36061000200", data_value: 31 },
    { locationname: "bad", data_value: "10" },
    { locationname: "36061000300", data_value: "n/a" },
  ]);
  assert.deepEqual(out, { "36061000100": 0.775, "36061000200": 0.69 });
  assert.match(placesUrl("https://data.cdc.gov/", "cwsq-ngmh", "36061", "tok"), /^https:\/\/data\.cdc\.gov\/resource\/cwsq-ngmh\.json\?countyfips=36061&measureid=LPA&.*%24%24app_token=tok$/);
});

test("night lights average tile pixels inside each area", () => {
  const z = 8;
  const { x, y } = tileXY(-74, 40.7, z);
  assert.deepEqual(tilesForBBox({ w: -74.01, s: 40.69, e: -73.99, n: 40.71 }, z), [{ x, y }]);
  assert.equal(tileUrl("https://t/{z}/{y}/{x}.png", z, x, y), `https://t/8/${y}/${x}.png`);
  // A 256px RGBA tile: left half bright white, right half black.
  const size = 256;
  const data = new Uint8Array(size * size * 4);
  for (let py = 0; py < size; py++) for (let px = 0; px < size / 2; px++) data.set([255, 255, 255, 255], (py * size + px) * 4);
  const n = 2 ** z;
  const lngAt = (fx: number) => ((x + fx) / n) * 360 - 180;
  const latAt = (fy: number) => (Math.atan(Math.sinh(Math.PI * (1 - (2 * (y + fy)) / n))) * 180) / Math.PI;
  const box = (fx0: number, fx1: number) => {
    const b = { w: lngAt(fx0), e: lngAt(fx1), n: latAt(0.3), s: latAt(0.7) };
    return { bbox: b, geometry: square(b.w, b.s, b.e, b.n), lat: (b.s + b.n) / 2, lng: (b.w + b.e) / 2 };
  };
  const areas = [
    { geoid: "bright", ...box(0.1, 0.3) },
    { geoid: "dark", ...box(0.7, 0.9) },
    { geoid: "half", ...box(0.4, 0.6) },
  ];
  const out = sampleNightLights([{ x, y, z, img: { width: size, height: size, channels: 4, data } }], areas);
  assert.equal(out.get("bright"), 100);
  assert.equal(out.get("dark"), 0);
  assert.ok(Math.abs(out.get("half")! - 50) < 3, `half is ~50, got ${out.get("half")}`);
  // Indexed PNGs use the palette.
  const indexed = { width: 1, height: 1, channels: 1, data: [1], palette: [[0, 0, 0], [255, 255, 255]] };
  const tiny = sampleNightLights([{ x, y, z, img: indexed }], [{ geoid: "p", ...box(0.4, 0.6) }]);
  assert.equal(tiny.get("p"), 100);
});
