import type { User } from "./auth";
import { type LegendEntry, sendTripSummary } from "./email";
import { HttpError, json, num, str } from "./http";
import { loadZones } from "./zones";

const MAX_SEGMENTS = 2000;
const MAX_POINTS_PER_SEGMENT = 10000;
const MAX_TOTAL_POINTS = 100000;
const MAX_PINS = 1000;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Point = [number, number];

function haversine(a: Point, b: Point): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b[0] - a[0]);
  const dLng = toRad(b[1] - a[1]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a[0])) * Math.cos(toRad(b[0])) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function pathLength(path: Point[]): number {
  let total = 0;
  for (let i = 1; i < path.length; i++) total += haversine(path[i - 1], path[i]);
  return total;
}

function lat(value: unknown): number {
  const v = num(value, "Latitude");
  if (v < -90 || v > 90) throw new HttpError(400, "Latitude out of range.", "validation");
  return Math.round(v * 1e6) / 1e6;
}

function lng(value: unknown): number {
  const v = num(value, "Longitude");
  if (v < -180 || v > 180) throw new HttpError(400, "Longitude out of range.", "validation");
  return Math.round(v * 1e6) / 1e6;
}

function timestamp(value: unknown, fallback: number): number {
  if (value === undefined || value === null) return fallback;
  const v = num(value, "Timestamp");
  return Math.round(v);
}

function parsePath(value: unknown): Point[] {
  if (!Array.isArray(value)) throw new HttpError(400, "Segment path must be a list of points.", "validation");
  if (value.length > MAX_POINTS_PER_SEGMENT) throw new HttpError(400, "A segment has too many points.", "validation");
  return value.map((p) => {
    if (!Array.isArray(p) || p.length < 2) throw new HttpError(400, "Each point must be [lat, lng].", "validation");
    return [lat(p[0]), lng(p[1])] as Point;
  });
}

function parseLegend(raw: string): LegendEntry[] {
  try {
    const value = JSON.parse(raw);
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

export async function createTrip(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  user: User,
  body: Record<string, unknown>,
): Promise<Response> {
  const now = Date.now();
  const tripId = typeof body.id === "string" && UUID_RE.test(body.id) ? body.id.toLowerCase() : crypto.randomUUID();

  // The client retries uploads on flaky connections; a retry of a saved trip is a no-op.
  const existing = await env.DB.prepare("SELECT user_id FROM trips WHERE id = ?").bind(tripId).first<{ user_id: string }>();
  if (existing) {
    if (existing.user_id !== user.id) throw new HttpError(409, "Trip id conflict.", "conflict");
    return json({ trip: { id: tripId }, duplicate: true });
  }

  const name = str(body.name, "Trip name", { max: 120 }) || `Drive on ${new Date(now).toISOString().slice(0, 10)}`;
  const notes = str(body.notes, "Notes", { max: 10000 });
  const startedAt = timestamp(body.startedAt, now);
  const endedAt = timestamp(body.endedAt, now);
  const zones = await loadZones(env, user.id);

  const checkZone = (id: unknown) => {
    if (typeof id !== "string" || !zones.has(id)) throw new HttpError(400, "Unknown zone on a segment.", "validation");
    if (user.plan !== "pro" && zones.get(id)!.is_default !== 1) {
      throw new HttpError(402, "Custom zones are a Pro feature.", "pro_required");
    }
    return id;
  };

  const rawSegments = Array.isArray(body.segments) ? body.segments : [];
  if (rawSegments.length > MAX_SEGMENTS) throw new HttpError(400, "Too many segments in one trip.", "validation");
  let totalPoints = 0;
  const segments = rawSegments
    .map((raw: any) => {
      const zoneTypeId = checkZone(raw?.zoneTypeId);
      const path = parsePath(raw?.path);
      totalPoints += path.length;
      return {
        id: crypto.randomUUID(),
        zoneTypeId,
        path,
        lengthM: pathLength(path),
        startedAt: timestamp(raw?.startedAt, startedAt),
        endedAt: timestamp(raw?.endedAt, endedAt),
      };
    })
    .filter((s) => s.path.length >= 2);
  if (totalPoints > MAX_TOTAL_POINTS) throw new HttpError(400, "This trip has too many points.", "validation");

  const rawPins = Array.isArray(body.pins) ? body.pins : [];
  if (rawPins.length > MAX_PINS) throw new HttpError(400, "Too many notes in one trip.", "validation");
  const pins = rawPins.map((raw: any) => ({
    id: crypto.randomUUID(),
    zoneTypeId: raw?.zoneTypeId ? checkZone(raw.zoneTypeId) : null,
    lat: lat(raw?.lat),
    lng: lng(raw?.lng),
    note: str(raw?.note, "Note", { max: 1000 }),
    createdAt: timestamp(raw?.createdAt, now),
  }));

  if (segments.length === 0 && pins.length === 0) {
    throw new HttpError(400, "Nothing was painted on this trip yet.", "empty_trip");
  }

  const legendNotes = (body.legendNotes && typeof body.legendNotes === "object" ? body.legendNotes : {}) as Record<
    string,
    unknown
  >;
  const usedZoneIds = new Set<string>([
    ...segments.map((s) => s.zoneTypeId),
    ...pins.flatMap((p) => (p.zoneTypeId ? [p.zoneTypeId] : [])),
  ]);
  const legend: LegendEntry[] = [...zones.values()]
    .filter((z) => usedZoneIds.has(z.id))
    .map((z) => ({
      zoneTypeId: z.id,
      name: z.name,
      color: z.color,
      description: z.description,
      tripNote: str(legendNotes[z.id], "Key note", { max: 1000 }),
    }));

  const metersByZone = new Map<string, number>();
  for (const s of segments) metersByZone.set(s.zoneTypeId, (metersByZone.get(s.zoneTypeId) || 0) + s.lengthM);
  const distanceM = segments.reduce((sum, s) => sum + s.lengthM, 0);

  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO trips (id, user_id, name, notes, legend, started_at, ended_at, distance_m, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(tripId, user.id, name, notes, JSON.stringify(legend), startedAt, endedAt, distanceM, now),
    ...segments.map((s) =>
      env.DB.prepare(
        `INSERT INTO segments (id, trip_id, user_id, zone_type_id, path, length_m, started_at, ended_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(s.id, tripId, user.id, s.zoneTypeId, JSON.stringify(s.path), s.lengthM, s.startedAt, s.endedAt),
    ),
    ...pins.map((p) =>
      env.DB.prepare(
        `INSERT INTO pins (id, trip_id, user_id, zone_type_id, lat, lng, note, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(p.id, tripId, user.id, p.zoneTypeId, p.lat, p.lng, p.note, p.createdAt),
    ),
  ]);

  if (body.emailSummary === true && !user.isGuest) {
    const origin = new URL(request.url).origin;
    ctx.waitUntil(
      sendTripSummary(
        env,
        user.email,
        origin,
        { id: tripId, name, notes, distanceM, startedAt, endedAt },
        legend,
        metersByZone,
        pins.length,
      ).catch((err) => console.error("Trip summary email failed", err)),
    );
  }

  return json({ trip: { id: tripId } }, { status: 201 });
}

interface TripRow {
  id: string;
  name: string;
  notes: string;
  legend: string;
  started_at: number;
  ended_at: number;
  distance_m: number;
}

function tripDto(row: TripRow, metersByZone: Record<string, number> = {}) {
  return {
    id: row.id,
    name: row.name,
    notes: row.notes,
    legend: parseLegend(row.legend),
    startedAt: row.started_at,
    endedAt: row.ended_at,
    distanceM: row.distance_m,
    metersByZone,
  };
}

export async function listTrips(env: Env, user: User): Promise<Response> {
  const [trips, totals] = await env.DB.batch([
    env.DB.prepare(
      `SELECT id, name, notes, legend, started_at, ended_at, distance_m
       FROM trips WHERE user_id = ? ORDER BY started_at DESC LIMIT 500`,
    ).bind(user.id),
    env.DB.prepare(
      `SELECT trip_id, zone_type_id, SUM(length_m) AS meters
       FROM segments WHERE user_id = ? GROUP BY trip_id, zone_type_id`,
    ).bind(user.id),
  ]);
  const byTrip: Record<string, Record<string, number>> = {};
  for (const t of totals.results as { trip_id: string; zone_type_id: string; meters: number }[]) {
    (byTrip[t.trip_id] ||= {})[t.zone_type_id] = t.meters;
  }
  return json({ trips: (trips.results as unknown as TripRow[]).map((t) => tripDto(t, byTrip[t.id])) });
}

async function ownTrip(env: Env, user: User, id: string): Promise<TripRow> {
  const trip = await env.DB.prepare(
    `SELECT id, name, notes, legend, started_at, ended_at, distance_m FROM trips WHERE id = ? AND user_id = ?`,
  )
    .bind(id, user.id)
    .first<TripRow>();
  if (!trip) throw new HttpError(404, "Trip not found.", "not_found");
  return trip;
}

interface SegmentRow {
  id: string;
  trip_id: string;
  zone_type_id: string;
  path: string;
  length_m: number;
}

interface PinRow {
  id: string;
  trip_id: string;
  zone_type_id: string | null;
  lat: number;
  lng: number;
  note: string;
  created_at: number;
}

const segmentDto = (s: SegmentRow) => ({
  id: s.id,
  tripId: s.trip_id,
  zoneTypeId: s.zone_type_id,
  path: JSON.parse(s.path) as Point[],
  lengthM: s.length_m,
});

const pinDto = (p: PinRow) => ({
  id: p.id,
  tripId: p.trip_id,
  zoneTypeId: p.zone_type_id,
  lat: p.lat,
  lng: p.lng,
  note: p.note,
  createdAt: p.created_at,
});

export async function getTrip(env: Env, user: User, id: string): Promise<Response> {
  const trip = await ownTrip(env, user, id);
  const [segments, pins] = await env.DB.batch([
    env.DB.prepare("SELECT id, trip_id, zone_type_id, path, length_m FROM segments WHERE trip_id = ? ORDER BY started_at").bind(id),
    env.DB.prepare("SELECT id, trip_id, zone_type_id, lat, lng, note, created_at FROM pins WHERE trip_id = ? ORDER BY created_at").bind(id),
  ]);
  const segs = (segments.results as unknown as SegmentRow[]).map(segmentDto);
  const metersByZone: Record<string, number> = {};
  for (const s of segs) metersByZone[s.zoneTypeId] = (metersByZone[s.zoneTypeId] || 0) + s.lengthM;
  return json({
    trip: tripDto(trip, metersByZone),
    segments: segs,
    pins: (pins.results as unknown as PinRow[]).map(pinDto),
  });
}

export async function updateTrip(env: Env, user: User, id: string, body: Record<string, unknown>): Promise<Response> {
  const trip = await ownTrip(env, user, id);
  const name = body.name !== undefined ? str(body.name, "Trip name", { max: 120, required: true }) : trip.name;
  const notes = body.notes !== undefined ? str(body.notes, "Notes", { max: 10000 }) : trip.notes;
  const legend = parseLegend(trip.legend);
  if (body.legendNotes && typeof body.legendNotes === "object") {
    const notesByZone = body.legendNotes as Record<string, unknown>;
    for (const entry of legend) {
      if (notesByZone[entry.zoneTypeId] !== undefined) {
        entry.tripNote = str(notesByZone[entry.zoneTypeId], "Key note", { max: 1000 });
      }
    }
  }
  await env.DB.prepare("UPDATE trips SET name = ?, notes = ?, legend = ? WHERE id = ?")
    .bind(name, notes, JSON.stringify(legend), id)
    .run();
  return json({ trip: tripDto({ ...trip, name, notes, legend: JSON.stringify(legend) }) });
}

export async function deleteTrip(env: Env, user: User, id: string): Promise<Response> {
  await ownTrip(env, user, id);
  await env.DB.prepare("DELETE FROM trips WHERE id = ? AND user_id = ?").bind(id, user.id).run();
  return json({ ok: true });
}

/** Everything the user has ever painted, for the "My map" overview. */
export async function getMap(env: Env, user: User): Promise<Response> {
  const [trips, segments, pins] = await env.DB.batch([
    env.DB.prepare(
      `SELECT id, name, notes, legend, started_at, ended_at, distance_m FROM trips WHERE user_id = ? ORDER BY started_at DESC`,
    ).bind(user.id),
    env.DB.prepare("SELECT id, trip_id, zone_type_id, path, length_m FROM segments WHERE user_id = ? LIMIT 20000").bind(user.id),
    env.DB.prepare(
      "SELECT id, trip_id, zone_type_id, lat, lng, note, created_at FROM pins WHERE user_id = ? ORDER BY created_at DESC LIMIT 5000",
    ).bind(user.id),
  ]);
  return json({
    trips: (trips.results as unknown as TripRow[]).map((t) => tripDto(t)),
    segments: (segments.results as unknown as SegmentRow[]).map(segmentDto),
    pins: (pins.results as unknown as PinRow[]).map(pinDto),
  });
}
