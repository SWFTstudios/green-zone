import { sendLoginCode, sendWelcome } from "./email";
import { HttpError, getCookie, json, newId, randomToken, sha256Hex, str } from "./http";

export const SESSION_COOKIE = "gz_session";
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const GUEST_SESSION_TTL_MS = 365 * 24 * 60 * 60 * 1000;
const MAX_GUESTS_PER_NETWORK_PER_DAY = 30;
const GUEST_EMAIL_DOMAIN = "guest.invalid";
const CODE_TTL_MS = 10 * 60 * 1000;
const MAX_CODES_PER_HOUR = 5;
const MAX_CODE_ATTEMPTS = 5;

export type Plan = "free" | "pro";

export interface User {
  id: string;
  email: string;
  plan: Plan;
  createdAt: number;
  isGuest: boolean;
}

export const DEFAULT_ZONES = [
  {
    name: "Green zone",
    color: "#16a34a",
    description:
      "Good neighborhood. Feels safe; I'd walk here or let my kids play outside. Homes and yards are well kept.",
  },
  {
    name: "Yellow zone",
    color: "#eab308",
    description:
      "Mixed or changing. Some vacant or run-down houses, so use caution. Could be an opportunity.",
  },
  {
    name: "Red zone",
    color: "#dc2626",
    description:
      "Sketchy. I wouldn't feel safe walking here or letting my kids play outside. Lots of boarded-up or abandoned properties.",
  },
];

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function normalizeEmail(value: unknown): string {
  const email = str(value, "Email", { max: 254, required: true }).toLowerCase();
  if (!EMAIL_RE.test(email) || email.endsWith(`@${GUEST_EMAIL_DOMAIN}`)) {
    throw new HttpError(400, "Enter a valid email address.", "validation");
  }
  return email;
}

function isProEmail(env: Env, email: string): boolean {
  const list = (env.PRO_EMAILS || "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  return list.includes(email);
}

function codeHash(email: string, code: string): Promise<string> {
  return sha256Hex(`${email}:${code}`);
}

function sixDigitCode(): string {
  const n = crypto.getRandomValues(new Uint32Array(1))[0] % 1_000_000;
  return n.toString().padStart(6, "0");
}

function seedZones(env: Env, userId: string, now: number): D1PreparedStatement[] {
  return DEFAULT_ZONES.map((zone, i) =>
    env.DB.prepare(
      `INSERT INTO zone_types (id, user_id, name, color, description, is_default, sort_order, created_at)
       VALUES (?, ?, ?, ?, ?, 1, ?, ?)`,
    ).bind(newId(), userId, zone.name, zone.color, zone.description, i, now),
  );
}

async function newSession(env: Env, userId: string, ttlMs: number, now: number): Promise<string> {
  const token = randomToken();
  await env.DB.batch([
    env.DB.prepare("DELETE FROM sessions WHERE user_id = ? AND expires_at < ?").bind(userId, now),
    env.DB.prepare("INSERT INTO sessions (token_hash, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)").bind(
      await sha256Hex(token),
      userId,
      now + ttlMs,
      now,
    ),
  ]);
  return token;
}

/** POST /api/auth/guest: starts a guest account tied to this browser, no email needed. */
export async function startGuest(request: Request, env: Env): Promise<Response> {
  if (await currentUser(request, env)) return json({ ok: true, existing: true });
  const now = Date.now();
  const network = await sha256Hex(`guest:${request.headers.get("cf-connecting-ip") || "local"}`);
  const recent = await env.DB.prepare("SELECT COUNT(*) AS n FROM users WHERE is_guest = 1 AND guest_ip = ? AND created_at > ?")
    .bind(network, now - 24 * 60 * 60 * 1000)
    .first<{ n: number }>();
  if ((recent?.n || 0) >= MAX_GUESTS_PER_NETWORK_PER_DAY) {
    throw new HttpError(429, "Too many guest accounts from this network today. Sign in with email instead.", "rate_limited");
  }
  const id = newId();
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO users (id, email, plan, created_at, last_login_at, is_guest, guest_ip) VALUES (?, ?, 'free', ?, ?, 1, ?)`,
    ).bind(id, `guest-${id}@${GUEST_EMAIL_DOMAIN}`, now, now, network),
    ...seedZones(env, id, now),
  ]);
  const token = await newSession(env, id, GUEST_SESSION_TTL_MS, now);
  return json({ ok: true }, { headers: { "set-cookie": sessionCookie(request, token, GUEST_SESSION_TTL_MS / 1000) } });
}

/**
 * Moves everything a guest made into an existing account. Painted streets on the guest's
 * Green/Yellow/Red are re-pointed at the account's own defaults; custom zones move as-is.
 */
function mergeGuestStatements(env: Env, guestId: string, userId: string): D1PreparedStatement[] {
  const remap = (table: "segments" | "pins") =>
    env.DB.prepare(
      `UPDATE ${table} SET zone_type_id = (
         SELECT u.id FROM zone_types u JOIN zone_types g ON g.sort_order = u.sort_order
         WHERE u.user_id = ?1 AND u.is_default = 1 AND g.id = ${table}.zone_type_id
       )
       WHERE user_id = ?2 AND zone_type_id IN (SELECT id FROM zone_types WHERE user_id = ?2 AND is_default = 1)`,
    ).bind(userId, guestId);
  return [
    remap("segments"),
    remap("pins"),
    env.DB.prepare("DELETE FROM zone_types WHERE user_id = ? AND is_default = 1").bind(guestId),
    env.DB.prepare("UPDATE zone_types SET user_id = ? WHERE user_id = ?").bind(userId, guestId),
    env.DB.prepare("UPDATE trips SET user_id = ? WHERE user_id = ?").bind(userId, guestId),
    env.DB.prepare("UPDATE segments SET user_id = ? WHERE user_id = ?").bind(userId, guestId),
    env.DB.prepare("UPDATE pins SET user_id = ? WHERE user_id = ?").bind(userId, guestId),
    env.DB.prepare("UPDATE saved_searches SET user_id = ? WHERE user_id = ?").bind(userId, guestId),
    env.DB.prepare("DELETE FROM users WHERE id = ? AND is_guest = 1").bind(guestId),
  ];
}

/** Daily: removes guest accounts older than 30 days that never saved a trip or a search. */
export async function cleanupGuests(env: Env): Promise<number> {
  const result = await env.DB.prepare(
    `DELETE FROM users WHERE is_guest = 1 AND created_at < ?
       AND NOT EXISTS (SELECT 1 FROM trips t WHERE t.user_id = users.id)
       AND NOT EXISTS (SELECT 1 FROM saved_searches s WHERE s.user_id = users.id)`,
  )
    .bind(Date.now() - 30 * 24 * 60 * 60 * 1000)
    .run();
  return result.meta.changes || 0;
}

export async function requestCode(request: Request, env: Env, body: Record<string, unknown>): Promise<Response> {
  const email = normalizeEmail(body.email);
  const now = Date.now();

  const recent = await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM login_codes WHERE email = ? AND created_at > ?",
  )
    .bind(email, now - 60 * 60 * 1000)
    .first<{ n: number }>();
  if ((recent?.n || 0) >= MAX_CODES_PER_HOUR) {
    throw new HttpError(429, "Too many codes requested. Try again in an hour.", "rate_limited");
  }

  const code = sixDigitCode();
  await env.DB.prepare(
    "INSERT INTO login_codes (id, email, code_hash, expires_at, created_at) VALUES (?, ?, ?, ?, ?)",
  )
    .bind(newId(), email, await codeHash(email, code), now + CODE_TTL_MS, now)
    .run();

  const origin = new URL(request.url).origin;
  try {
    await sendLoginCode(env, email, code, origin);
  } catch (err) {
    console.error("Failed to send login code", err);
    if (env.DEV_MODE !== "1") {
      throw new HttpError(502, "We couldn't send the email. Please try again.", "email_failed");
    }
  }

  return json({ ok: true, ...(env.DEV_MODE === "1" ? { devCode: code } : {}) });
}

export async function verifyCode(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  body: Record<string, unknown>,
): Promise<Response> {
  const email = normalizeEmail(body.email);
  const code = str(body.code, "Code", { max: 12, required: true }).replace(/\s+/g, "");
  const now = Date.now();

  const row = await env.DB.prepare(
    `SELECT id, code_hash, attempts FROM login_codes
     WHERE email = ? AND used_at IS NULL AND expires_at > ?
     ORDER BY created_at DESC LIMIT 1`,
  )
    .bind(email, now)
    .first<{ id: string; code_hash: string; attempts: number }>();

  if (!row) throw new HttpError(400, "That code has expired. Request a new one.", "code_expired");
  if (row.attempts >= MAX_CODE_ATTEMPTS) {
    throw new HttpError(400, "Too many wrong tries. Request a new code.", "code_locked");
  }
  if ((await codeHash(email, code)) !== row.code_hash) {
    await env.DB.prepare("UPDATE login_codes SET attempts = attempts + 1 WHERE id = ?").bind(row.id).run();
    throw new HttpError(400, "That code isn't right. Check the email and try again.", "code_wrong");
  }
  await env.DB.prepare("UPDATE login_codes SET used_at = ? WHERE id = ?").bind(now, row.id).run();

  // Signing in from a guest session keeps what the guest made.
  const current = await currentUser(request, env);
  const guestId = current?.isGuest ? current.id : null;

  let user = await env.DB.prepare("SELECT id FROM users WHERE email = ?").bind(email).first<{ id: string }>();
  let isNew = false;
  let merged = false;
  if (!user && guestId) {
    isNew = true;
    user = { id: guestId };
    await env.DB.prepare("UPDATE users SET email = ?, is_guest = 0, guest_ip = NULL, last_login_at = ? WHERE id = ?")
      .bind(email, now, guestId)
      .run();
  } else if (!user) {
    isNew = true;
    user = { id: newId() };
    await env.DB.batch([
      env.DB.prepare("INSERT INTO users (id, email, plan, created_at, last_login_at) VALUES (?, ?, 'free', ?, ?)").bind(
        user.id,
        email,
        now,
        now,
      ),
      ...seedZones(env, user.id, now),
    ]);
  } else {
    const statements = [env.DB.prepare("UPDATE users SET last_login_at = ? WHERE id = ?").bind(now, user.id)];
    if (guestId && guestId !== user.id) {
      statements.push(...mergeGuestStatements(env, guestId, user.id));
      merged = true;
    }
    await env.DB.batch(statements);
  }

  const oldToken = getCookie(request, SESSION_COOKIE);
  if (oldToken) await env.DB.prepare("DELETE FROM sessions WHERE token_hash = ?").bind(await sha256Hex(oldToken)).run();
  const token = await newSession(env, user.id, SESSION_TTL_MS, now);

  const origin = new URL(request.url).origin;
  if (isNew) {
    ctx.waitUntil(sendWelcome(env, email, origin).catch((err) => console.error("Welcome email failed", err)));
  }

  return json(
    { ok: true, isNew, merged },
    { headers: { "set-cookie": sessionCookie(request, token, SESSION_TTL_MS / 1000) } },
  );
}

function sessionCookie(request: Request, token: string, maxAgeSeconds: number): string {
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  return `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSeconds}${secure}`;
}

export async function logout(request: Request, env: Env): Promise<Response> {
  const token = getCookie(request, SESSION_COOKIE);
  if (token) {
    await env.DB.prepare("DELETE FROM sessions WHERE token_hash = ?").bind(await sha256Hex(token)).run();
  }
  return json({ ok: true }, { headers: { "set-cookie": sessionCookie(request, "", 0) } });
}

export async function currentUser(request: Request, env: Env): Promise<User | null> {
  const token = getCookie(request, SESSION_COOKIE);
  if (!token) return null;
  const row = await env.DB.prepare(
    `SELECT u.id, u.email, u.plan, u.created_at, u.is_guest FROM sessions s
     JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = ? AND s.expires_at > ?`,
  )
    .bind(await sha256Hex(token), Date.now())
    .first<{ id: string; email: string; plan: Plan; created_at: number; is_guest: number }>();
  if (!row) return null;
  return {
    id: row.id,
    email: row.email,
    plan: row.plan === "pro" || isProEmail(env, row.email) ? "pro" : "free",
    createdAt: row.created_at,
    isGuest: row.is_guest === 1,
  };
}

export async function requireUser(request: Request, env: Env): Promise<User> {
  const user = await currentUser(request, env);
  if (!user) throw new HttpError(401, "Please sign in.", "unauthorized");
  return user;
}
