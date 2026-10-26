import type { User } from "./auth";
import { HttpError, json, newId, str } from "./http";

const MAX_ACTIVE_ZONES = 24;
const HEX_RE = /^#[0-9a-fA-F]{6}$/;

export interface ZoneRow {
  id: string;
  name: string;
  color: string;
  description: string;
  is_default: number;
  sort_order: number;
  archived: number;
}

export function zoneDto(zone: ZoneRow, user: User) {
  return {
    id: zone.id,
    name: zone.name,
    color: zone.color,
    description: zone.description,
    isDefault: zone.is_default === 1,
    archived: zone.archived === 1,
    locked: user.plan !== "pro" && zone.is_default !== 1,
  };
}

/** All of a user's zones, including archived ones (needed to validate and render old trips). */
export async function loadZones(env: Env, userId: string): Promise<Map<string, ZoneRow>> {
  const { results } = await env.DB.prepare(
    `SELECT id, name, color, description, is_default, sort_order, archived
     FROM zone_types WHERE user_id = ? ORDER BY sort_order, created_at`,
  )
    .bind(userId)
    .all<ZoneRow>();
  return new Map(results.map((z) => [z.id, z]));
}

export async function listZones(env: Env, user: User): Promise<Response> {
  const zones = [...(await loadZones(env, user.id)).values()].filter((z) => z.archived === 0);
  return json({ zones: zones.map((z) => zoneDto(z, user)) });
}

function requirePro(user: User, what: string): void {
  if (user.plan !== "pro") throw new HttpError(402, `${what} is a Pro feature.`, "pro_required");
}

function color(value: unknown): string {
  const c = str(value, "Color", { max: 7, required: true });
  if (!HEX_RE.test(c)) throw new HttpError(400, "Color must look like #22aa55.", "validation");
  return c.toLowerCase();
}

export async function createZone(env: Env, user: User, body: Record<string, unknown>): Promise<Response> {
  requirePro(user, "Adding your own zones");
  const name = str(body.name, "Name", { max: 40, required: true });
  const zoneColor = color(body.color);
  const description = str(body.description, "Description", { max: 500 });

  const counts = await env.DB.prepare(
    "SELECT COUNT(*) AS n, COALESCE(MAX(sort_order), 0) AS maxSort FROM zone_types WHERE user_id = ? AND archived = 0",
  )
    .bind(user.id)
    .first<{ n: number; maxSort: number }>();
  if ((counts?.n || 0) >= MAX_ACTIVE_ZONES) {
    throw new HttpError(400, `You can have up to ${MAX_ACTIVE_ZONES} zones.`, "limit");
  }

  const zone: ZoneRow = {
    id: newId(),
    name,
    color: zoneColor,
    description,
    is_default: 0,
    sort_order: (counts?.maxSort || 0) + 1,
    archived: 0,
  };
  await env.DB.prepare(
    `INSERT INTO zone_types (id, user_id, name, color, description, is_default, sort_order, created_at)
     VALUES (?, ?, ?, ?, ?, 0, ?, ?)`,
  )
    .bind(zone.id, user.id, zone.name, zone.color, zone.description, zone.sort_order, Date.now())
    .run();
  return json({ zone: zoneDto(zone, user) }, { status: 201 });
}

async function ownZone(env: Env, user: User, id: string): Promise<ZoneRow> {
  const zone = await env.DB.prepare(
    `SELECT id, name, color, description, is_default, sort_order, archived
     FROM zone_types WHERE id = ? AND user_id = ? AND archived = 0`,
  )
    .bind(id, user.id)
    .first<ZoneRow>();
  if (!zone) throw new HttpError(404, "Zone not found.", "not_found");
  return zone;
}

export async function updateZone(env: Env, user: User, id: string, body: Record<string, unknown>): Promise<Response> {
  const zone = await ownZone(env, user, id);
  // Everyone can write what a color means (the key). Renaming and recoloring is Pro.
  if (body.description !== undefined) zone.description = str(body.description, "Description", { max: 500 });
  if (body.name !== undefined || body.color !== undefined) {
    requirePro(user, "Renaming and recoloring zones");
    if (body.name !== undefined) zone.name = str(body.name, "Name", { max: 40, required: true });
    if (body.color !== undefined) zone.color = color(body.color);
  }
  if (user.plan !== "pro" && zone.is_default !== 1) requirePro(user, "Adding your own zones");
  await env.DB.prepare("UPDATE zone_types SET name = ?, color = ?, description = ? WHERE id = ?")
    .bind(zone.name, zone.color, zone.description, zone.id)
    .run();
  return json({ zone: zoneDto(zone, user) });
}

export async function deleteZone(env: Env, user: User, id: string): Promise<Response> {
  requirePro(user, "Adding your own zones");
  const zone = await ownZone(env, user, id);
  if (zone.is_default === 1) throw new HttpError(400, "Green, Yellow and Red can't be deleted.", "validation");
  // Archive rather than delete so trips painted with this zone still render.
  await env.DB.prepare("UPDATE zone_types SET archived = 1 WHERE id = ?").bind(zone.id).run();
  return json({ ok: true });
}
