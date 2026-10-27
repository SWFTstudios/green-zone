/** Parsing for Zillow Research CSVs (wide format: one row per ZIP, one column per month). */

export interface ZillowDataset {
  id: string;
  label: string;
  path: string;
  column: string;
  yoyColumn?: string;
  monthColumn?: string;
}

export const ZILLOW_DATASETS: ZillowDataset[] = [
  {
    id: "zhvi_all",
    label: "Home values, all homes (ZHVI)",
    path: "zhvi/Zip_zhvi_uc_sfrcondo_tier_0.33_0.67_sm_sa_month.csv",
    column: "zhvi",
    yoyColumn: "zhvi_yoy",
    monthColumn: "zhvi_month",
  },
  {
    id: "zhvi_sfr",
    label: "Home values, single-family",
    path: "zhvi/Zip_zhvi_uc_sfr_tier_0.33_0.67_sm_sa_month.csv",
    column: "zhvi_sfr",
  },
  {
    id: "zhvi_condo",
    label: "Home values, condo/co-op",
    path: "zhvi/Zip_zhvi_uc_condo_tier_0.33_0.67_sm_sa_month.csv",
    column: "zhvi_condo",
  },
  ...[1, 2, 3, 4, 5].map((n) => ({
    id: `zhvi_${n}br`,
    label: `Home values, ${n === 5 ? "5+" : n} bedroom`,
    path: `zhvi/Zip_zhvi_bdrmcnt_${n}_uc_sfrcondo_tier_0.33_0.67_sm_sa_month.csv`,
    column: `zhvi_${n}br`,
  })),
  {
    id: "zori",
    label: "Rents, all homes + multifamily (ZORI)",
    path: "zori/Zip_zori_uc_sfrcondomfr_sm_month.csv",
    column: "zori",
    yoyColumn: "zori_yoy",
    monthColumn: "zori_month",
  },
];

export interface ZillowRow {
  zip: string;
  state: string | null;
  city: string | null;
  metro: string | null;
  county: string | null;
  value: number;
  yoy: number | null;
}

/** Splits one CSV line, honoring double-quoted fields (metro names contain commas). */
export function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quoted) {
      if (c === '"') {
        if (line[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") {
      out.push(field);
      field = "";
    } else field += c;
  }
  out.push(field);
  return out;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Feed lines one at a time; keeps only the latest value (and its 12-month change) per ZIP. */
export class ZillowCsvParser {
  month: string | null = null;
  private cols: { zip: number; state: number; city: number; metro: number; county: number; dates: number[] } | null = null;

  pushLine(rawLine: string): ZillowRow | null {
    const line = rawLine.replace(/\r$/, "");
    if (!line.trim()) return null;
    const fields = parseCsvLine(line);
    if (!this.cols) {
      const idx = (name: string) => fields.indexOf(name);
      const dates = fields.map((f, i) => (DATE_RE.test(f) ? i : -1)).filter((i) => i >= 0);
      if (idx("RegionName") < 0 || !dates.length) throw new Error("Unrecognized Zillow CSV header");
      this.cols = { zip: idx("RegionName"), state: idx("State"), city: idx("City"), metro: idx("Metro"), county: idx("CountyName"), dates };
      this.month = fields[dates[dates.length - 1]].slice(0, 7);
      return null;
    }
    const c = this.cols;
    const zip = (fields[c.zip] || "").trim().padStart(5, "0");
    if (!/^\d{5}$/.test(zip)) return null;
    // Use the newest month with data, looking back at most 3 months for sparse ZIPs.
    for (let back = 0; back < 3; back++) {
      const i = c.dates.length - 1 - back;
      if (i < 0) break;
      const value = parseFloat(fields[c.dates[i]]);
      if (!Number.isFinite(value) || value <= 0) continue;
      const prior = i >= 12 ? parseFloat(fields[c.dates[i - 12]]) : NaN;
      const text = (k: number) => (k >= 0 && fields[k] ? fields[k].trim().slice(0, 120) : null);
      return {
        zip,
        state: text(c.state),
        city: text(c.city),
        metro: text(c.metro),
        county: text(c.county),
        value,
        yoy: Number.isFinite(prior) && prior > 0 ? value / prior - 1 : null,
      };
    }
    return null;
  }
}

function sqlText(value: string | null): string {
  if (value === null) return "NULL";
  return `'${value.replace(/[\u0000-\u001f]/g, "").replace(/'/g, "''")}'`;
}

function sqlNum(value: number | null, decimals: number): string {
  if (value === null || !Number.isFinite(value)) return "NULL";
  const f = 10 ** decimals;
  return String(Math.round(value * f) / f);
}

/**
 * Builds multi-row upserts with literal values. D1 allows only 100 bound parameters per query,
 * so literals keep a 30k-row file to a few dozen statements. Every value is escaped or numeric.
 */
export function buildUpserts(dataset: ZillowDataset, rows: ZillowRow[], month: string | null, now: number, maxBytes = 90000): string[] {
  const cols = ["zip", "state", "city", "metro", "county", dataset.column];
  if (dataset.yoyColumn) cols.push(dataset.yoyColumn);
  if (dataset.monthColumn) cols.push(dataset.monthColumn);
  cols.push("updated_at");
  const updates = [
    ...["state", "city", "metro", "county"].map((k) => `${k} = COALESCE(excluded.${k}, zip_market.${k})`),
    `${dataset.column} = excluded.${dataset.column}`,
    ...(dataset.yoyColumn ? [`${dataset.yoyColumn} = excluded.${dataset.yoyColumn}`] : []),
    ...(dataset.monthColumn ? [`${dataset.monthColumn} = excluded.${dataset.monthColumn}`] : []),
    "updated_at = excluded.updated_at",
  ].join(", ");
  const head = `INSERT INTO zip_market (${cols.join(", ")}) VALUES `;
  const tail = ` ON CONFLICT(zip) DO UPDATE SET ${updates}`;

  const statements: string[] = [];
  let values: string[] = [];
  let size = head.length + tail.length;
  for (const r of rows) {
    const parts = [sqlText(r.zip), sqlText(r.state), sqlText(r.city), sqlText(r.metro), sqlText(r.county), sqlNum(r.value, 2)];
    if (dataset.yoyColumn) parts.push(sqlNum(r.yoy, 5));
    if (dataset.monthColumn) parts.push(sqlText(month));
    parts.push(String(now));
    const tuple = `(${parts.join(", ")})`;
    if (values.length && size + tuple.length + 1 > maxBytes) {
      statements.push(head + values.join(",") + tail);
      values = [];
      size = head.length + tail.length;
    }
    values.push(tuple);
    size += tuple.length + 1;
  }
  if (values.length) statements.push(head + values.join(",") + tail);
  return statements;
}
