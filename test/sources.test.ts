import assert from "node:assert/strict";
import { test } from "node:test";
import { exportSize, floodExportUrl, floodTileTemplate, sampleCoverage } from "../src/areas/flood.ts";
import type { AreaGeometry } from "../src/areas/geo.ts";
import { monthlyPayment, parseFredCsv } from "../src/areas/mortgage.ts";
import { parseRentcastMarket, rentcastMarketUrl } from "../src/areas/rentcast.ts";

const square = (w: number, s: number, e: number, n: number): AreaGeometry => ({
  type: "Polygon",
  coordinates: [[[w, s], [e, s], [e, n], [w, n], [w, s]]],
});
const area = (geoid: string, w: number, s: number, e: number, n: number) => ({
  geoid,
  bbox: { w, s, e, n },
  geometry: square(w, s, e, n),
  lat: (s + n) / 2,
  lng: (w + e) / 2,
});

test("flood export asks for only the 100-year floodplain at about 12 m a pixel", () => {
  const b = { w: -75.2, s: 39.9, e: -75.1, n: 40 };
  const size = exportSize(b);
  assert.ok(size.width > 600 && size.width < 750, `width ${size.width}`);
  assert.ok(size.height > 850 && size.height < 950, `height ${size.height}`);
  const big = exportSize({ w: -76, s: 39, e: -75, n: 40 });
  assert.ok(Math.max(big.width, big.height) <= 2048);
  const url = new URL(floodExportUrl("https://fema.example/MapServer/", b, size));
  assert.equal(url.pathname, "/MapServer/export");
  assert.equal(url.searchParams.get("layers"), "show:28");
  assert.equal(url.searchParams.get("layerDefs"), JSON.stringify({ 28: "SFHA_TF = 'T'" }));
  assert.equal(url.searchParams.get("bboxSR"), "4326");
  assert.ok(floodTileTemplate("https://fema.example/MapServer").includes("bbox={bbox-epsg-3857}"));
});

test("flood coverage counts drawn pixels inside each area", () => {
  // 10x10 image over (0,0)-(10,10); the top half (north) is floodplain.
  const width = 10;
  const height = 10;
  const data = new Uint8Array(width * height * 4);
  for (let y = 0; y < 5; y++) for (let x = 0; x < width; x++) data[(y * width + x) * 4 + 3] = 200;
  const img = { width, height, channels: 4, data };
  const b = { w: 0, s: 0, e: 10, n: 10 };
  const out = sampleCoverage(img, b, [area("north", 0, 5, 10, 10), area("south", 0, 0, 10, 5), area("all", 0, 0, 10, 10), area("tiny", 2.01, 7.01, 2.02, 7.02)]);
  assert.equal(out.get("north"), 1);
  assert.equal(out.get("south"), 0);
  assert.equal(out.get("all"), 0.5);
  assert.equal(out.get("tiny"), 1, "areas smaller than a pixel use the pixel under them");
  // Palette images with a transparent entry.
  const pal = { width: 2, height: 1, channels: 1, data: new Uint8Array([0, 1]), palette: [[0, 0, 0, 0], [20, 90, 200, 255]] };
  assert.equal(sampleCoverage(pal, { w: 0, s: 0, e: 2, n: 1 }, [area("a", 0, 0, 2, 1)]).get("a"), 0.5);
});

test("FRED CSV gives the latest weekly rate, skipping missing weeks", () => {
  assert.deepEqual(parseFredCsv("observation_date,MORTGAGE30US\n2026-10-08,6.34\n2026-10-15,6.30\n2026-10-22,.\n"), { rate: 6.3, date: "2026-10-15" });
  assert.equal(parseFredCsv("observation_date,MORTGAGE30US\n"), null);
  assert.equal(parseFredCsv("<html>error</html>"), null);
});

test("mortgage payment uses 20% down over 30 years", () => {
  // $300k home, $240k loan at 6% is about $1,439 a month.
  assert.equal(Math.round(monthlyPayment(300000, 6)), 1439);
  assert.equal(Math.round(monthlyPayment(360000, 0)), 800);
});

test("RentCast market response is reduced to the numbers we show", () => {
  assert.equal(rentcastMarketUrl("https://api.rentcast.io/v1/", "07607"), "https://api.rentcast.io/v1/markets?zipCode=07607&dataType=All&historyRange=1");
  const s = parseRentcastMarket("07607", {
    saleData: { lastUpdatedDate: "2026-10-20T00:00:00.000Z", medianPrice: 512000, averagePrice: 540000.4, medianPricePerSquareFoot: 301.256, medianDaysOnMarket: 24, totalListings: 41, newListings: 7 },
    rentalData: { medianRent: 2650, averageRent: "n/a", totalListings: 18 },
  });
  assert.equal(s.updated, "2026-10-20");
  assert.equal(s.sale?.medianPrice, 512000);
  assert.equal(s.sale?.medianPricePerSqft, 301.26);
  assert.equal(s.rent?.medianRent, 2650);
  assert.equal(s.rent?.averageRent, null);
  assert.deepEqual(parseRentcastMarket("00000", null), { zip: "00000", updated: null, sale: null, rent: null });
});
