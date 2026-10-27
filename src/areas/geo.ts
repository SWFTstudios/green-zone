/** Geometry helpers. GeoJSON order throughout: [lng, lat]. */

export type Position = [number, number];
export type Ring = Position[];
export type AreaGeometry =
  | { type: "Polygon"; coordinates: Ring[] }
  | { type: "MultiPolygon"; coordinates: Ring[][] };

export interface BBox {
  w: number;
  s: number;
  e: number;
  n: number;
}

function pointInRing(lng: number, lat: number, ring: Ring): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function pointInPolygonRings(lng: number, lat: number, rings: Ring[]): boolean {
  if (!rings.length || !pointInRing(lng, lat, rings[0])) return false;
  for (let i = 1; i < rings.length; i++) if (pointInRing(lng, lat, rings[i])) return false;
  return true;
}

export function pointInGeometry(lng: number, lat: number, geom: AreaGeometry): boolean {
  if (geom.type === "Polygon") return pointInPolygonRings(lng, lat, geom.coordinates);
  return geom.coordinates.some((poly) => pointInPolygonRings(lng, lat, poly));
}

export function geometryBBox(geom: AreaGeometry): BBox {
  const box = { w: Infinity, s: Infinity, e: -Infinity, n: -Infinity };
  const polys = geom.type === "Polygon" ? [geom.coordinates] : geom.coordinates;
  for (const poly of polys) {
    for (const [lng, lat] of poly[0] || []) {
      if (lng < box.w) box.w = lng;
      if (lng > box.e) box.e = lng;
      if (lat < box.s) box.s = lat;
      if (lat > box.n) box.n = lat;
    }
  }
  return box;
}

export function bboxContains(b: BBox, lng: number, lat: number): boolean {
  return lng >= b.w && lng <= b.e && lat >= b.s && lat <= b.n;
}

export function bboxIntersects(a: BBox, b: BBox): boolean {
  return a.w <= b.e && a.e >= b.w && a.s <= b.n && a.n >= b.s;
}

export function unionBBox(boxes: BBox[]): BBox {
  return boxes.reduce(
    (u, b) => ({ w: Math.min(u.w, b.w), s: Math.min(u.s, b.s), e: Math.max(u.e, b.e), n: Math.max(u.n, b.n) }),
    { w: Infinity, s: Infinity, e: -Infinity, n: -Infinity },
  );
}

export function bboxSpan(b: BBox): number {
  return Math.max(b.e - b.w, b.n - b.s);
}

/** Parses "w,s,e,n" and rejects anything that isn't a sane lng/lat box. */
export function parseBBox(value: string | null): BBox | null {
  if (!value) return null;
  const parts = value.split(",").map(Number);
  if (parts.length !== 4 || parts.some((p) => !Number.isFinite(p))) return null;
  const [w, s, e, n] = parts;
  if (w < -180 || e > 180 || s < -90 || n > 90 || w >= e || s >= n) return null;
  return { w, s, e, n };
}

/** Square tiles of `size` degrees, keyed "size:x:y", used to remember which areas were fetched. */
export function tilesFor(b: BBox, size: number): string[] {
  const keys: string[] = [];
  for (let x = Math.floor(b.w / size); x <= Math.floor(b.e / size); x++) {
    for (let y = Math.floor(b.s / size); y <= Math.floor(b.n / size); y++) keys.push(`${size}:${x}:${y}`);
  }
  return keys;
}

export function tileBBox(key: string): BBox {
  const [size, x, y] = key.split(":").map(Number);
  return { w: x * size, s: y * size, e: (x + 1) * size, n: (y + 1) * size };
}

/** Rounds coordinates to `decimals` places (5 ≈ 1 m) and drops repeated points to shrink storage. */
export function roundGeometry(geom: AreaGeometry, decimals = 5): AreaGeometry {
  const f = 10 ** decimals;
  const ring = (r: Ring): Ring => {
    const out: Ring = [];
    for (const [lng, lat] of r) {
      const p: Position = [Math.round(lng * f) / f, Math.round(lat * f) / f];
      const last = out[out.length - 1];
      if (!last || last[0] !== p[0] || last[1] !== p[1]) out.push(p);
    }
    return out;
  };
  if (geom.type === "Polygon") return { type: "Polygon", coordinates: geom.coordinates.map(ring) };
  return { type: "MultiPolygon", coordinates: geom.coordinates.map((p) => p.map(ring)) };
}

export function isAreaGeometry(value: unknown): value is AreaGeometry {
  const g = value as AreaGeometry;
  return !!g && (g.type === "Polygon" || g.type === "MultiPolygon") && Array.isArray(g.coordinates);
}

/** Finds the area containing a point, checking cheap bounding boxes first. */
export function findContaining<T extends { bbox: BBox; geometry: AreaGeometry }>(
  items: T[],
  lng: number,
  lat: number,
): T | null {
  for (const item of items) {
    if (bboxContains(item.bbox, lng, lat) && pointInGeometry(lng, lat, item.geometry)) return item;
  }
  return null;
}
