/**
 * CDC PLACES: model-based estimates per census tract (public domain). We use one measure,
 * LPA ("no leisure-time physical activity among adults"), and invert it into the share of
 * adults who do exercise in their free time.
 */

export interface PlacesRow {
  locationname?: string;
  locationid?: string;
  measureid?: string;
  data_value?: string | number;
}

export function placesUrl(base: string, dataset: string, county: string, token?: string): string {
  const params = new URLSearchParams({
    countyfips: county,
    measureid: "LPA",
    $select: "locationname,locationid,data_value",
    $limit: "5000",
  });
  if (token) params.set("$$app_token", token);
  return `${base.replace(/\/+$/, "")}/resource/${dataset}.json?${params}`;
}

/** Tract GEOID → share of adults who are physically active in their free time (0–1). */
export function parsePlaces(rows: PlacesRow[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const row of rows) {
    const geoid = String(row.locationname ?? row.locationid ?? "");
    const inactive = Number(row.data_value);
    if (!/^\d{11}$/.test(geoid) || !Number.isFinite(inactive) || inactive < 0 || inactive > 100) continue;
    out[geoid] = Math.round((1 - inactive / 100) * 10000) / 10000;
  }
  return out;
}
