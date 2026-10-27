import { type AreaGeometry, type BBox, findContaining } from "./geo.ts";

/**
 * OpenStreetMap features via the Overpass API. These stand in for "where people are active
 * outside" (parks, trails, fitness spots), "well lit at night" (lit streets, street lamps),
 * everyday amenities, transit, and mapped land use.
 */

export interface OsmCounts {
  litWays: number;
  streetLamps: number;
  paths: number;
  parks: number;
  playgrounds: number;
  fitness: number;
  transit: number;
  grocery: number;
  shops: number;
  schools: number;
  food: number;
  healthcare: number;
  landuse: Record<string, number>;
}

export interface OsmElement {
  type: "node" | "way" | "relation";
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
}

const PATHS = /^(footway|path|cycleway|pedestrian|track|bridleway|steps)$/;
const PARKS = /^(park|garden|nature_reserve|recreation_ground|dog_park|common)$/;
const FITNESS = /^(pitch|track|fitness_station|fitness_centre|sports_centre|swimming_pool)$/;
const LANDUSE =
  "residential|commercial|retail|industrial|construction|brownfield|greenfield|recreation_ground|farmland|meadow|forest|grass|cemetery|railway|religious|education|institutional";

export function overpassQuery(b: BBox): string {
  return `[out:json][timeout:60][maxsize:268435456][bbox:${b.s},${b.w},${b.n},${b.e}];
(
  way["highway"]["lit"="yes"];
  node["highway"="street_lamp"];
  way["highway"~"^(footway|path|cycleway|pedestrian|track|bridleway|steps)$"];
  nwr["leisure"~"^(park|garden|nature_reserve|recreation_ground|dog_park|common|playground|pitch|track|fitness_station|fitness_centre|sports_centre|swimming_pool)$"];
  nwr["landuse"~"^(${LANDUSE})$"];
  nwr["amenity"~"^(school|kindergarten|college|university|library|hospital|clinic|doctors|pharmacy|cafe|restaurant|bar|pub|fast_food)$"];
  nwr["shop"~"^(supermarket|greengrocer|convenience|department_store|mall|hardware|doityourself)$"];
  node["highway"="bus_stop"];
  nwr["public_transport"="station"];
  nwr["railway"~"^(station|halt|tram_stop)$"];
);
out center qt;`;
}

export function emptyCounts(): OsmCounts {
  return {
    litWays: 0,
    streetLamps: 0,
    paths: 0,
    parks: 0,
    playgrounds: 0,
    fitness: 0,
    transit: 0,
    grocery: 0,
    shops: 0,
    schools: 0,
    food: 0,
    healthcare: 0,
    landuse: {},
  };
}

/** Adds one OSM element to the counts. An element can count in several categories. */
export function countElement(counts: OsmCounts, el: OsmElement): void {
  const t = el.tags || {};
  if (el.type === "way" && t.highway && t.lit === "yes") counts.litWays++;
  if (el.type === "node" && t.highway === "street_lamp") counts.streetLamps++;
  if (el.type === "way" && t.highway && PATHS.test(t.highway)) counts.paths++;
  if (t.leisure && PARKS.test(t.leisure)) counts.parks++;
  if (t.leisure === "playground") counts.playgrounds++;
  if (t.leisure && FITNESS.test(t.leisure)) counts.fitness++;
  if (t.highway === "bus_stop" || t.public_transport === "station" || /^(station|halt|tram_stop)$/.test(t.railway || "")) {
    counts.transit++;
  }
  if (t.shop === "supermarket" || t.shop === "greengrocer") counts.grocery++;
  else if (t.shop) counts.shops++;
  if (/^(school|kindergarten|college|university|library)$/.test(t.amenity || "")) counts.schools++;
  if (/^(cafe|restaurant|bar|pub|fast_food)$/.test(t.amenity || "")) counts.food++;
  if (/^(hospital|clinic|doctors|pharmacy)$/.test(t.amenity || "")) counts.healthcare++;
  if (t.landuse) counts.landuse[t.landuse] = (counts.landuse[t.landuse] || 0) + 1;
}

/** Buckets elements into the area that contains each one's location (or center). */
export function aggregateOsm(
  elements: OsmElement[],
  areas: { geoid: string; bbox: BBox; geometry: AreaGeometry }[],
): Map<string, OsmCounts> {
  const out = new Map(areas.map((a) => [a.geoid, emptyCounts()]));
  for (const el of elements) {
    const lat = el.lat ?? el.center?.lat;
    const lon = el.lon ?? el.center?.lon;
    if (lat === undefined || lon === undefined) continue;
    const area = findContaining(areas, lon, lat);
    if (area) countElement(out.get(area.geoid)!, el);
  }
  return out;
}

const LANDUSE_LABELS: Record<string, string> = {
  residential: "Residential",
  commercial: "Commercial",
  retail: "Retail",
  industrial: "Industrial",
  construction: "Under construction",
  brownfield: "Brownfield (vacant, previously developed)",
  greenfield: "Greenfield (planned development)",
  recreation_ground: "Recreation",
  farmland: "Farmland",
  meadow: "Open land",
  grass: "Open land",
  forest: "Forest",
  cemetery: "Cemetery",
  railway: "Rail",
  religious: "Religious",
  education: "Education",
  institutional: "Institutional",
};

export function landUseSummary(landuse: Record<string, number>): { dominant: string | null; mix: Record<string, number> } {
  const mix: Record<string, number> = {};
  for (const [key, count] of Object.entries(landuse)) {
    const label = LANDUSE_LABELS[key] || key;
    mix[label] = (mix[label] || 0) + count;
  }
  const dominant = Object.entries(mix).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  return { dominant, mix };
}
