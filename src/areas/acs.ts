/**
 * Census American Community Survey (5-year) per tract. Only housing, market and economic
 * variables are requested; nothing about race, ethnicity, religion, sex, familial status or
 * disability is used, so area scores can't be built on protected characteristics.
 */

export const ACS_VARIABLES = {
  population: "B01003_001E",
  medianHomeValue: "B25077_001E",
  medianRent: "B25064_001E",
  medianIncome: "B19013_001E",
  unitsTotal: "B25002_001E",
  unitsVacant: "B25002_003E",
  occupied: "B25003_001E",
  ownerOccupied: "B25003_002E",
  medianYearBuilt: "B25035_001E",
  laborForce: "B23025_003E",
  unemployed: "B23025_005E",
  structTotal: "B25024_001E",
  sfDetached: "B25024_002E",
  sfAttached: "B25024_003E",
  units2: "B25024_004E",
  units3to4: "B25024_005E",
  units5to9: "B25024_006E",
  units10to19: "B25024_007E",
  units20to49: "B25024_008E",
  units50plus: "B25024_009E",
  mobileHome: "B25024_010E",
  commuters: "B08301_001E",
  commuteTransit: "B08301_010E",
  commuteBike: "B08301_018E",
  commuteWalk: "B08301_019E",
  workFromHome: "B08301_021E",
} as const;

export interface AcsMetrics {
  population: number | null;
  medianHomeValue: number | null;
  medianRent: number | null;
  medianIncome: number | null;
  housingUnits: number | null;
  vacancyRate: number | null;
  ownerOccupiedRate: number | null;
  renterRate: number | null;
  medianYearBuilt: number | null;
  unemploymentRate: number | null;
  pctSingleFamily: number | null;
  pctSmallMulti: number | null;
  pctLargeMulti: number | null;
  pctMobile: number | null;
  walkBikeRate: number | null;
  transitRate: number | null;
  workFromHomeRate: number | null;
}

type Key = keyof typeof ACS_VARIABLES;

/** Census uses large negative sentinels (e.g. -666666666) for "not available". */
function value(raw: string | undefined): number | null {
  if (raw === undefined || raw === null || raw === "") return null;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

function share(part: number | null, whole: number | null): number | null {
  if (part === null || whole === null || whole <= 0) return null;
  return Math.round((part / whole) * 10000) / 10000;
}

function sum(...values: (number | null)[]): number | null {
  if (values.some((v) => v === null)) return null;
  return (values as number[]).reduce((a, b) => a + b, 0);
}

/** Turns the Census API's array-of-arrays response into metrics keyed by 11-digit tract GEOID. */
export function parseAcsResponse(rows: string[][]): Record<string, AcsMetrics> {
  const [header, ...data] = rows;
  if (!Array.isArray(header)) return {};
  const col = new Map(header.map((h, i) => [h, i]));
  const get = (row: string[], key: Key) => value(row[col.get(ACS_VARIABLES[key]) ?? -1]);
  const travelers = (row: string[]) => {
    const total = get(row, "commuters");
    const home = get(row, "workFromHome");
    return total === null ? null : total - (home ?? 0);
  };
  const out: Record<string, AcsMetrics> = {};
  for (const row of data) {
    const geoid = `${row[col.get("state") ?? -1] ?? ""}${row[col.get("county") ?? -1] ?? ""}${row[col.get("tract") ?? -1] ?? ""}`;
    if (!/^\d{11}$/.test(geoid)) continue;
    const occupied = get(row, "occupied");
    const owner = get(row, "ownerOccupied");
    const struct = get(row, "structTotal");
    const yearBuilt = get(row, "medianYearBuilt");
    out[geoid] = {
      population: get(row, "population"),
      medianHomeValue: get(row, "medianHomeValue"),
      medianRent: get(row, "medianRent"),
      medianIncome: get(row, "medianIncome"),
      housingUnits: get(row, "unitsTotal"),
      vacancyRate: share(get(row, "unitsVacant"), get(row, "unitsTotal")),
      ownerOccupiedRate: share(owner, occupied),
      renterRate: owner !== null && occupied ? share(occupied - owner, occupied) : null,
      medianYearBuilt: yearBuilt && yearBuilt > 1800 ? yearBuilt : null,
      unemploymentRate: share(get(row, "unemployed"), get(row, "laborForce")),
      pctSingleFamily: share(sum(get(row, "sfDetached"), get(row, "sfAttached")), struct),
      pctSmallMulti: share(sum(get(row, "units2"), get(row, "units3to4")), struct),
      pctLargeMulti: share(
        sum(get(row, "units5to9"), get(row, "units10to19"), get(row, "units20to49"), get(row, "units50plus")),
        struct,
      ),
      pctMobile: share(get(row, "mobileHome"), struct),
      // Shares of people who travel to work (those working from home are left out).
      walkBikeRate: share(sum(get(row, "commuteWalk"), get(row, "commuteBike")), travelers(row)),
      transitRate: share(get(row, "commuteTransit"), travelers(row)),
      workFromHomeRate: share(get(row, "workFromHome"), get(row, "commuters")),
    };
  }
  return out;
}

export function acsUrl(base: string, year: string, county: string, key?: string): string {
  const vars = ["NAME", ...Object.values(ACS_VARIABLES)].join(",");
  const keyPart = key ? `&key=${encodeURIComponent(key)}` : "";
  return `${base.replace(/\/+$/, "")}/${year}/acs/acs5?get=${vars}&for=tract:*&in=state:${county.slice(0, 2)}%20county:${county.slice(2)}${keyPart}`;
}
