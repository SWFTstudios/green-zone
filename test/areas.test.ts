import assert from "node:assert/strict";
import { test } from "node:test";
import { parseAcsResponse, acsUrl, ACS_VARIABLES } from "../src/areas/acs.ts";
import { type AreaGeometry, findContaining, geometryBBox, parseBBox, pointInGeometry, roundGeometry, tileBBox, tilesFor } from "../src/areas/geo.ts";
import { aggregateOsm, countElement, emptyCounts, landUseSummary } from "../src/areas/osm.ts";
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
