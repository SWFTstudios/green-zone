import { USER_AGENT } from "./fetch";
import { ZILLOW_DATASETS, type ZillowDataset, type ZillowRow, ZillowCsvParser, buildUpserts } from "./zillowCsv";

const DEFAULT_BASE = "https://files.zillowstatic.com/research/public_csvs";
const STALE_MS = 27 * 24 * 60 * 60 * 1000;
const RETRY_FAILED_MS = 20 * 60 * 60 * 1000;
const FLUSH_ROWS = 3000;

export interface ImportResult {
  dataset: string;
  ok: boolean;
  rows: number;
  month: string | null;
  error?: string;
}

/** Downloads one Zillow CSV as a stream and upserts the latest values into zip_market. */
export async function importZillowDataset(env: Env, dataset: ZillowDataset): Promise<ImportResult> {
  const now = Date.now();
  const url = `${(env.ZILLOW_BASE_URL || DEFAULT_BASE).replace(/\/+$/, "")}/${dataset.path}`;
  const parser = new ZillowCsvParser();
  let pending: ZillowRow[] = [];
  let rows = 0;

  const flush = async () => {
    if (!pending.length) return;
    const statements = buildUpserts(dataset, pending, parser.month, now).map((sql) => env.DB.prepare(sql));
    for (let i = 0; i < statements.length; i += 10) await env.DB.batch(statements.slice(i, i + 10));
    rows += pending.length;
    pending = [];
  };

  try {
    const res = await fetch(url, { headers: { "user-agent": USER_AGENT } });
    if (!res.ok || !res.body) throw new Error(`HTTP ${res.status} for ${url}`);
    const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
    let buffer = "";
    for (;;) {
      const { value, done } = await reader.read();
      if (value) buffer += value;
      let nl: number;
      while ((nl = buffer.indexOf("\n")) >= 0) {
        const row = parser.pushLine(buffer.slice(0, nl));
        buffer = buffer.slice(nl + 1);
        if (row) pending.push(row);
      }
      if (pending.length >= FLUSH_ROWS) await flush();
      if (done) break;
    }
    const last = parser.pushLine(buffer);
    if (last) pending.push(last);
    await flush();
    if (!rows) throw new Error("No ZIP rows found in the file");

    await env.DB.prepare(
      `INSERT INTO zillow_imports (dataset, month, rows, imported_at, attempted_at, error) VALUES (?, ?, ?, ?, ?, NULL)
       ON CONFLICT(dataset) DO UPDATE SET month = excluded.month, rows = excluded.rows,
         imported_at = excluded.imported_at, attempted_at = excluded.attempted_at, error = NULL`,
    )
      .bind(dataset.id, parser.month, rows, now, now)
      .run();
    return { dataset: dataset.id, ok: true, rows, month: parser.month };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`Zillow import ${dataset.id} failed`, message);
    await env.DB.prepare(
      `INSERT INTO zillow_imports (dataset, attempted_at, error) VALUES (?, ?, ?)
       ON CONFLICT(dataset) DO UPDATE SET attempted_at = excluded.attempted_at, error = excluded.error`,
    )
      .bind(dataset.id, now, message.slice(0, 500))
      .run();
    return { dataset: dataset.id, ok: false, rows, month: parser.month, error: message };
  }
}

interface ImportRow {
  dataset: string;
  month: string | null;
  rows: number;
  imported_at: number | null;
  attempted_at: number;
  error: string | null;
}

export async function importStatus(env: Env): Promise<ImportRow[]> {
  const { results } = await env.DB.prepare(
    "SELECT dataset, month, rows, imported_at, attempted_at, error FROM zillow_imports",
  ).all<ImportRow>();
  return results;
}

/** Datasets that were never imported, are older than ~a month, or failed more than a day ago. */
export async function staleDatasets(env: Env): Promise<ZillowDataset[]> {
  const now = Date.now();
  const status = new Map((await importStatus(env)).map((r) => [r.dataset, r]));
  return ZILLOW_DATASETS.filter((d) => {
    const s = status.get(d.id);
    if (!s) return true;
    if (s.error && !s.imported_at) return now - s.attempted_at > RETRY_FAILED_MS;
    return !s.imported_at || now - s.imported_at > STALE_MS;
  });
}

/** Runs from the daily cron: refreshes up to three datasets per run to stay well inside limits. */
export async function refreshStaleZillow(env: Env, max = 3): Promise<ImportResult[]> {
  const results: ImportResult[] = [];
  for (const dataset of (await staleDatasets(env)).slice(0, max)) results.push(await importZillowDataset(env, dataset));
  return results;
}

export { ZILLOW_DATASETS };
