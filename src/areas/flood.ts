import { type AreaGeometry, type BBox, bboxContains, pointInGeometry } from "./geo.ts";
import type { DecodedTile } from "./nightlights.ts";

/**
 * FEMA National Flood Hazard Layer. We ask its map service to draw only the Special Flood Hazard
 * Area (the 1%-a-year, "100-year" floodplain, where lenders usually require flood insurance) over
 * a batch of tracts, then count the drawn pixels inside each tract.
 */

export const DEFAULT_FEMA_NFHL = "https://hazards.fema.gov/arcgis/rest/services/public/NFHL/MapServer";
/** "Flood Hazard Zones" in the NFHL map service. */
export const FLOOD_LAYER = 28;
const SFHA_ONLY = encodeURIComponent(JSON.stringify({ [FLOOD_LAYER]: "SFHA_TF = 'T'" }));
const METERS_PER_PIXEL = 12;
const MAX_SIDE = 2048;

/** Pixel size for an export of `b` at about 12 m per pixel, capped at 2048 px a side. */
export function exportSize(b: BBox): { width: number; height: number } {
  const midLat = ((b.s + b.n) / 2) * (Math.PI / 180);
  const widthM = (b.e - b.w) * 111320 * Math.cos(midLat);
  const heightM = (b.n - b.s) * 110540;
  const mpp = Math.max(METERS_PER_PIXEL, Math.max(widthM, heightM) / MAX_SIDE);
  return { width: Math.max(16, Math.round(widthM / mpp)), height: Math.max(16, Math.round(heightM / mpp)) };
}

/** An export of the floodplain over `b`, in plain longitude/latitude so pixels map linearly. */
export function floodExportUrl(base: string, b: BBox, size: { width: number; height: number }): string {
  return (
    `${base.replace(/\/+$/, "")}/export?bbox=${b.w},${b.s},${b.e},${b.n}&bboxSR=4326&imageSR=4326` +
    `&size=${size.width},${size.height}&format=png32&transparent=true&dpi=96` +
    `&layers=show:${FLOOD_LAYER}&layerDefs=${SFHA_ONLY}&f=image`
  );
}

/** Map overlay tiles; MapLibre fills in {bbox-epsg-3857} for each tile. */
export function floodTileTemplate(base: string): string {
  return (
    `${base.replace(/\/+$/, "")}/export?bbox={bbox-epsg-3857}&bboxSR=3857&imageSR=3857` +
    `&size=256,256&format=png32&transparent=true&dpi=96&layers=show:${FLOOD_LAYER}&layerDefs=${SFHA_ONLY}&f=image`
  );
}

/** True where the export drew something (any opaque pixel). */
function covered(img: DecodedTile, i: number): boolean {
  if (img.palette) {
    const entry = img.palette[img.data[i]];
    return !!entry && (entry.length > 3 ? entry[3] > 0 : true);
  }
  const c = img.channels;
  if (c === 4) return img.data[i * 4 + 3] > 0;
  if (c === 2) return img.data[i * 2 + 1] > 0;
  // No alpha channel: the service paints the floodplain over white.
  const o = i * c;
  return c >= 3 ? img.data[o] + img.data[o + 1] + img.data[o + 2] < 750 : img.data[o] < 250;
}

/**
 * Share (0–1) of each area covered by the export. Areas too small to contain a pixel center
 * use the pixel under their interior point.
 */
export function sampleCoverage(
  img: DecodedTile,
  b: BBox,
  areas: { geoid: string; bbox: BBox; geometry: AreaGeometry; lat: number; lng: number }[],
): Map<string, number> {
  const lngOf = (px: number) => b.w + ((px + 0.5) / img.width) * (b.e - b.w);
  const latOf = (py: number) => b.n - ((py + 0.5) / img.height) * (b.n - b.s);
  const colOf = (lng: number) => Math.floor(((lng - b.w) / (b.e - b.w)) * img.width);
  const rowOf = (lat: number) => Math.floor(((b.n - lat) / (b.n - b.s)) * img.height);
  const clampX = (x: number) => Math.min(img.width - 1, Math.max(0, x));
  const clampY = (y: number) => Math.min(img.height - 1, Math.max(0, y));

  const out = new Map<string, number>();
  for (const area of areas) {
    let inside = 0;
    let hits = 0;
    const x0 = clampX(colOf(area.bbox.w));
    const x1 = clampX(colOf(area.bbox.e));
    const y0 = clampY(rowOf(area.bbox.n));
    const y1 = clampY(rowOf(area.bbox.s));
    for (let py = y0; py <= y1; py++) {
      const lat = latOf(py);
      for (let px = x0; px <= x1; px++) {
        const lng = lngOf(px);
        if (!bboxContains(area.bbox, lng, lat) || !pointInGeometry(lng, lat, area.geometry)) continue;
        inside++;
        if (covered(img, py * img.width + px)) hits++;
      }
    }
    if (inside) out.set(area.geoid, Math.round((hits / inside) * 1000) / 1000);
    else if (area.lng >= b.w && area.lng <= b.e && area.lat >= b.s && area.lat <= b.n) {
      out.set(area.geoid, covered(img, clampY(rowOf(area.lat)) * img.width + clampX(colOf(area.lng))) ? 1 : 0);
    }
  }
  return out;
}
