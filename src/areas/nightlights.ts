import { type AreaGeometry, type BBox, bboxContains, pointInGeometry } from "./geo.ts";

/**
 * NASA Black Marble night lights, read from the same Web-Mercator PNG tiles that the map
 * shows as an overlay (NASA GIBS). For each area we average the brightness of the tile
 * pixels whose centers fall inside it, giving 0 (dark) to 100 (brightest).
 */

export interface DecodedTile {
  width: number;
  height: number;
  channels: number;
  data: ArrayLike<number>;
  palette?: number[][];
}

export function tileXY(lng: number, lat: number, z: number): { x: number; y: number } {
  const n = 2 ** z;
  const x = Math.floor(((lng + 180) / 360) * n);
  const rad = (lat * Math.PI) / 180;
  const y = Math.floor(((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * n);
  return { x: Math.min(n - 1, Math.max(0, x)), y: Math.min(n - 1, Math.max(0, y)) };
}

export function tilesForBBox(b: BBox, z: number): { x: number; y: number }[] {
  const a = tileXY(b.w, b.n, z);
  const c = tileXY(b.e, b.s, z);
  const out: { x: number; y: number }[] = [];
  for (let x = a.x; x <= c.x; x++) for (let y = a.y; y <= c.y; y++) out.push({ x, y });
  return out;
}

export function tileUrl(template: string, z: number, x: number, y: number): string {
  return template.replace("{z}", String(z)).replace("{x}", String(x)).replace("{y}", String(y));
}

/** Luminance 0–255 of one pixel; transparent pixels count as dark. */
function pixelBrightness(img: DecodedTile, i: number): number {
  const c = img.channels;
  if (img.palette) {
    const entry = img.palette[img.data[i]] || [0, 0, 0];
    const alpha = entry.length > 3 ? entry[3] / 255 : 1;
    return (0.2126 * entry[0] + 0.7152 * entry[1] + 0.0722 * entry[2]) * alpha;
  }
  const o = i * c;
  if (c <= 2) return img.data[o] * (c === 2 ? img.data[o + 1] / 255 : 1);
  const lum = 0.2126 * img.data[o] + 0.7152 * img.data[o + 1] + 0.0722 * img.data[o + 2];
  return c === 4 ? lum * (img.data[o + 3] / 255) : lum;
}

/**
 * Averages brightness per area over the given tiles. Areas with no pixel center inside them
 * (very small tracts) fall back to the pixel under their interior point.
 */
export function sampleNightLights(
  tiles: { x: number; y: number; z: number; img: DecodedTile }[],
  areas: { geoid: string; bbox: BBox; geometry: AreaGeometry; lat: number; lng: number }[],
): Map<string, number> {
  const sums = new Map<string, { total: number; count: number }>();
  const pointValue = new Map<string, number>();
  for (const { x, y, z, img } of tiles) {
    const n = 2 ** z;
    const lngOf = (px: number) => ((x + (px + 0.5) / img.width) / n) * 360 - 180;
    const latOf = (py: number) => {
      const merc = Math.PI * (1 - (2 * (y + (py + 0.5) / img.height)) / n);
      return (Math.atan(Math.sinh(merc)) * 180) / Math.PI;
    };
    const tileBox = { w: lngOf(-0.5), e: lngOf(img.width - 0.5), n: latOf(-0.5), s: latOf(img.height - 0.5) };
    for (const area of areas) {
      if (area.bbox.e < tileBox.w || area.bbox.w > tileBox.e || area.bbox.n < tileBox.s || area.bbox.s > tileBox.n) continue;
      const px0 = Math.max(0, Math.floor(((area.bbox.w + 180) / 360) * n * img.width - x * img.width));
      const px1 = Math.min(img.width - 1, Math.ceil(((area.bbox.e + 180) / 360) * n * img.width - x * img.width));
      const s = sums.get(area.geoid) || { total: 0, count: 0 };
      for (let py = 0; py < img.height; py++) {
        const lat = latOf(py);
        if (lat < area.bbox.s || lat > area.bbox.n) continue;
        for (let px = px0; px <= px1; px++) {
          const lng = lngOf(px);
          if (!bboxContains(area.bbox, lng, lat) || !pointInGeometry(lng, lat, area.geometry)) continue;
          s.total += pixelBrightness(img, py * img.width + px);
          s.count++;
        }
      }
      sums.set(area.geoid, s);
      if (!pointValue.has(area.geoid) && area.lng >= tileBox.w && area.lng <= tileBox.e && area.lat >= tileBox.s && area.lat <= tileBox.n) {
        const px = Math.min(img.width - 1, Math.floor(((area.lng + 180) / 360) * n * img.width - x * img.width));
        const rad = (area.lat * Math.PI) / 180;
        const gy = ((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * n * img.height - y * img.height;
        const py = Math.min(img.height - 1, Math.max(0, Math.floor(gy)));
        pointValue.set(area.geoid, pixelBrightness(img, py * img.width + px));
      }
    }
  }
  const out = new Map<string, number>();
  for (const area of areas) {
    const s = sums.get(area.geoid);
    const raw = s && s.count ? s.total / s.count : pointValue.get(area.geoid);
    if (raw !== undefined) out.set(area.geoid, Math.round((raw / 255) * 1000) / 10);
  }
  return out;
}
