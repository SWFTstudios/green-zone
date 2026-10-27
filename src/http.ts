export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public code = "error",
  ) {
    super(message);
  }
}

export function json(data: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json; charset=utf-8");
  headers.set("cache-control", "no-store");
  return new Response(JSON.stringify(data), { ...init, headers });
}

export function errorResponse(err: unknown): Response {
  if (err instanceof HttpError) {
    return json({ error: err.message, code: err.code }, { status: err.status });
  }
  console.error("Unhandled error", err);
  return json({ error: "Something went wrong. Please try again.", code: "internal" }, { status: 500 });
}

const MAX_BODY_BYTES = 4 * 1024 * 1024;

export async function readJson<T = Record<string, unknown>>(request: Request): Promise<T> {
  const type = request.headers.get("content-type") || "";
  if (!type.includes("application/json")) {
    throw new HttpError(415, "Expected a JSON body.", "bad_content_type");
  }
  const length = Number(request.headers.get("content-length") || 0);
  if (length > MAX_BODY_BYTES) throw new HttpError(413, "Request is too large.", "too_large");
  const text = await request.text();
  if (text.length > MAX_BODY_BYTES) throw new HttpError(413, "Request is too large.", "too_large");
  try {
    const value = JSON.parse(text);
    if (!value || typeof value !== "object") throw new Error("not an object");
    return value as T;
  } catch {
    throw new HttpError(400, "Invalid JSON body.", "bad_json");
  }
}

/** Rejects cross-site state-changing requests (cookies are SameSite=Lax, this is defense in depth). */
export function assertSameOrigin(request: Request): void {
  if (request.method === "GET" || request.method === "HEAD") return;
  const origin = request.headers.get("origin");
  if (!origin) return;
  if (origin !== new URL(request.url).origin) {
    throw new HttpError(403, "Cross-site request blocked.", "bad_origin");
  }
}

export function getCookie(request: Request, name: string): string | null {
  const header = request.headers.get("cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return decodeURIComponent(rest.join("="));
  }
  return null;
}

export function str(value: unknown, field: string, { max = 500, required = false } = {}): string {
  if (value === undefined || value === null) {
    if (required) throw new HttpError(400, `${field} is required.`, "validation");
    return "";
  }
  if (typeof value !== "string") throw new HttpError(400, `${field} must be text.`, "validation");
  const trimmed = value.trim();
  if (required && !trimmed) throw new HttpError(400, `${field} is required.`, "validation");
  if (trimmed.length > max) throw new HttpError(400, `${field} must be at most ${max} characters.`, "validation");
  return trimmed;
}

export function num(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new HttpError(400, `${field} must be a number.`, "validation");
  }
  return value;
}

export function newId(): string {
  return crypto.randomUUID();
}

export async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function randomToken(bytes = 32): string {
  const buf = crypto.getRandomValues(new Uint8Array(bytes));
  return btoa(String.fromCharCode(...buf)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
