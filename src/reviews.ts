import type { User } from "./auth";
import { sendReview } from "./email";
import { HttpError, json, sha256Hex } from "./http";

const MAX_PER_DAY = 5;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DAY_MS = 24 * 60 * 60 * 1000;

function text(value: unknown, max: number): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

/**
 * POST /api/reviews  { rating 1–5, message, name?, email?, source: "landing" | "app", website? }
 * Anyone can leave one, signed in or not. The review is stored, then emailed to REVIEW_TO,
 * which only the server knows. `website` is a honeypot that real visitors never see.
 */
export async function createReview(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  user: User | null,
  body: Record<string, unknown>,
): Promise<Response> {
  // Bots fill every field; pretend it worked.
  if (text(body.website, 200)) return json({ ok: true });

  const rating = Number(body.rating);
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) throw new HttpError(400, "Pick a rating from 1 to 5 stars.", "validation");
  const message = text(body.message, 2000);
  if (message.length < 2) throw new HttpError(400, "Write a few words about your experience.", "validation");
  const name = text(body.name, 80) || null;
  const email = text(body.email, 254).toLowerCase() || null;
  if (email && !EMAIL_RE.test(email)) throw new HttpError(400, "That email doesn't look right. Leave it blank if you don't want a reply.", "validation");
  const source = body.source === "app" ? "app" : "landing";

  const now = Date.now();
  const ipHash = await sha256Hex(`review:${request.headers.get("cf-connecting-ip") || "local"}`);
  const recent = await env.DB.prepare("SELECT COUNT(*) AS n FROM reviews WHERE ip_hash = ? AND created_at > ?")
    .bind(ipHash, now - DAY_MS)
    .first<{ n: number }>();
  if ((recent?.n ?? 0) >= MAX_PER_DAY) throw new HttpError(429, "Thanks! You've sent several reviews today. Try again tomorrow.", "rate_limited");

  const id = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO reviews (id, created_at, rating, message, name, email, source, user_id, ip_hash)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(id, now, rating, message, name, email, source, user?.id ?? null, ipHash)
    .run();

  const to = env.REVIEW_TO;
  if (to) {
    const account = !user ? "Not signed in" : user.isGuest ? "Guest" : `${user.plan === "pro" ? "Pro" : "Free"} account`;
    ctx.waitUntil(
      sendReview(env, to, { rating, message, name, email, source, account, createdAt: now })
        .then(() => env.DB.prepare("UPDATE reviews SET emailed_at = ? WHERE id = ?").bind(Date.now(), id).run())
        .catch((err) => console.error("Review email failed", err instanceof Error ? err.message : err)),
    );
  } else {
    console.warn("REVIEW_TO is not set; review saved without emailing it.");
  }
  return json({ ok: true }, { status: 201 });
}
