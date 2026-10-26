import { sendLoginCode, sendWelcome } from "./email";
import { HttpError, getCookie, json, newId, randomToken, sha256Hex, str } from "./http";

export const SESSION_COOKIE = "gz_session";
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const CODE_TTL_MS = 10 * 60 * 1000;
const MAX_CODES_PER_HOUR = 5;
const MAX_CODE_ATTEMPTS = 5;

export type Plan = "free" | "pro";

export interface User {
  id: string;
  email: string;
  plan: Plan;
  createdAt: number;
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
  if (!EMAIL_RE.test(email)) throw new HttpError(400, "Enter a valid email address.", "validation");
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

  let user = await env.DB.prepare("SELECT id FROM users WHERE email = ?").bind(email).first<{ id: string }>();
  let isNew = false;
  if (!user) {
    isNew = true;
    user = { id: newId() };
    const statements = [
      env.DB.prepare("INSERT INTO users (id, email, plan, created_at, last_login_at) VALUES (?, ?, 'free', ?, ?)").bind(
        user.id,
        email,
        now,
        now,
      ),
      ...DEFAULT_ZONES.map((zone, i) =>
        env.DB.prepare(
          `INSERT INTO zone_types (id, user_id, name, color, description, is_default, sort_order, created_at)
           VALUES (?, ?, ?, ?, ?, 1, ?, ?)`,
        ).bind(newId(), user!.id, zone.name, zone.color, zone.description, i, now),
      ),
    ];
    await env.DB.batch(statements);
  } else {
    await env.DB.prepare("UPDATE users SET last_login_at = ? WHERE id = ?").bind(now, user.id).run();
  }

  const token = randomToken();
  await env.DB.batch([
    env.DB.prepare("DELETE FROM sessions WHERE user_id = ? AND expires_at < ?").bind(user.id, now),
    env.DB.prepare("INSERT INTO sessions (token_hash, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)").bind(
      await sha256Hex(token),
      user.id,
      now + SESSION_TTL_MS,
      now,
    ),
  ]);

  const origin = new URL(request.url).origin;
  if (isNew) {
    ctx.waitUntil(sendWelcome(env, email, origin).catch((err) => console.error("Welcome email failed", err)));
  }

  return json({ ok: true, isNew }, { headers: { "set-cookie": sessionCookie(request, token, SESSION_TTL_MS / 1000) } });
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
    `SELECT u.id, u.email, u.plan, u.created_at FROM sessions s
     JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = ? AND s.expires_at > ?`,
  )
    .bind(await sha256Hex(token), Date.now())
    .first<{ id: string; email: string; plan: Plan; created_at: number }>();
  if (!row) return null;
  return {
    id: row.id,
    email: row.email,
    plan: row.plan === "pro" || isProEmail(env, row.email) ? "pro" : "free",
    createdAt: row.created_at,
  };
}

export async function requireUser(request: Request, env: Env): Promise<User> {
  const user = await currentUser(request, env);
  if (!user) throw new HttpError(401, "Please sign in.", "unauthorized");
  return user;
}
