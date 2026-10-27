import type { User } from "./auth";
import { HttpError, json, newId, str } from "./http";

const LIMITS = { free: 5, pro: 100 } as const;
const MAX_JSON = 200_000;

interface SearchRow {
  id: string;
  name: string;
  criteria: string;
  view: string;
  results: string;
  created_at: number;
  updated_at: number;
}

function jsonField(value: unknown, field: string, max = MAX_JSON): string {
  if (!value || typeof value !== "object") throw new HttpError(400, `${field} is required.`, "validation");
  const text = JSON.stringify(value);
  if (text.length > max) throw new HttpError(413, `${field} is too large.`, "too_large");
  return text;
}

function parse(text: string) {
  try {
    return JSON.parse(text);
  } catch {
    return {};
  }
}

function dto(row: SearchRow, full = true) {
  const results = parse(row.results);
  return {
    id: row.id,
    name: row.name,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    counts: results.counts || null,
    ...(full ? { criteria: parse(row.criteria), view: parse(row.view), results } : {}),
  };
}

async function own(env: Env, user: User, id: string): Promise<SearchRow> {
  const row = await env.DB.prepare(
    "SELECT id, name, criteria, view, results, created_at, updated_at FROM saved_searches WHERE id = ? AND user_id = ?",
  )
    .bind(id, user.id)
    .first<SearchRow>();
  if (!row) throw new HttpError(404, "Saved search not found.", "not_found");
  return row;
}

export async function listSearches(env: Env, user: User): Promise<Response> {
  const { results } = await env.DB.prepare(
    `SELECT id, name, criteria, view, results, created_at, updated_at FROM saved_searches
     WHERE user_id = ? ORDER BY updated_at DESC LIMIT 200`,
  )
    .bind(user.id)
    .all<SearchRow>();
  return json({ searches: results.map((r) => dto(r, false)), limit: LIMITS[user.plan] });
}

export async function getSearch(env: Env, user: User, id: string): Promise<Response> {
  return json({ search: dto(await own(env, user, id)) });
}

export async function createSearch(env: Env, user: User, body: Record<string, unknown>): Promise<Response> {
  const count = await env.DB.prepare("SELECT COUNT(*) AS n FROM saved_searches WHERE user_id = ?")
    .bind(user.id)
    .first<{ n: number }>();
  const limit = LIMITS[user.plan];
  if ((count?.n || 0) >= limit) {
    throw new HttpError(
      user.plan === "pro" ? 400 : 402,
      user.plan === "pro"
        ? `You can save up to ${limit} searches. Delete one to save another.`
        : `Free accounts can save ${limit} searches. Delete one, or upgrade to Pro for more.`,
      user.plan === "pro" ? "limit" : "pro_required",
    );
  }
  const now = Date.now();
  const row: SearchRow = {
    id: newId(),
    name: str(body.name, "Name", { max: 80, required: true }),
    criteria: jsonField(body.criteria, "Criteria"),
    view: jsonField(body.view, "Map view", 2000),
    results: body.results ? jsonField(body.results, "Results") : "{}",
    created_at: now,
    updated_at: now,
  };
  await env.DB.prepare(
    `INSERT INTO saved_searches (id, user_id, name, criteria, view, results, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(row.id, user.id, row.name, row.criteria, row.view, row.results, now, now)
    .run();
  return json({ search: dto(row) }, { status: 201 });
}

export async function updateSearch(env: Env, user: User, id: string, body: Record<string, unknown>): Promise<Response> {
  const row = await own(env, user, id);
  if (body.name !== undefined) row.name = str(body.name, "Name", { max: 80, required: true });
  if (body.criteria !== undefined) row.criteria = jsonField(body.criteria, "Criteria");
  if (body.view !== undefined) row.view = jsonField(body.view, "Map view", 2000);
  if (body.results !== undefined) row.results = jsonField(body.results, "Results");
  row.updated_at = Date.now();
  await env.DB.prepare("UPDATE saved_searches SET name = ?, criteria = ?, view = ?, results = ?, updated_at = ? WHERE id = ?")
    .bind(row.name, row.criteria, row.view, row.results, row.updated_at, id)
    .run();
  return json({ search: dto(row) });
}

export async function deleteSearch(env: Env, user: User, id: string): Promise<Response> {
  await own(env, user, id);
  await env.DB.prepare("DELETE FROM saved_searches WHERE id = ? AND user_id = ?").bind(id, user.id).run();
  return json({ ok: true });
}
