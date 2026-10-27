import { currentUser, logout, requestCode, requireUser, verifyCode } from "./auth";
import { HttpError, assertSameOrigin, errorResponse, json, readJson } from "./http";
import { createTrip, deleteTrip, getMap, getTrip, listTrips, updateTrip } from "./trips";
import { createZone, deleteZone, listZones, updateZone } from "./zones";

async function handleApi(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, "");
  const method = request.method;
  assertSameOrigin(request);

  if (path === "/api/auth/request" && method === "POST") return requestCode(request, env, await readJson(request));
  if (path === "/api/auth/verify" && method === "POST") return verifyCode(request, env, ctx, await readJson(request));
  if (path === "/api/auth/logout" && method === "POST") return logout(request, env);

  if (path === "/api/me" && method === "GET") {
    const user = await currentUser(request, env);
    return json({ user: user && { email: user.email, plan: user.plan, createdAt: user.createdAt } });
  }

  const user = await requireUser(request, env);

  if (path === "/api/zones") {
    if (method === "GET") return listZones(env, user);
    if (method === "POST") return createZone(env, user, await readJson(request));
  }
  const zoneMatch = path.match(/^\/api\/zones\/([\w-]+)$/);
  if (zoneMatch) {
    if (method === "PATCH") return updateZone(env, user, zoneMatch[1], await readJson(request));
    if (method === "DELETE") return deleteZone(env, user, zoneMatch[1]);
  }

  if (path === "/api/trips") {
    if (method === "GET") return listTrips(env, user);
    if (method === "POST") return createTrip(request, env, ctx, user, await readJson(request));
  }
  const tripMatch = path.match(/^\/api\/trips\/([\w-]+)$/);
  if (tripMatch) {
    if (method === "GET") return getTrip(env, user, tripMatch[1]);
    if (method === "PATCH") return updateTrip(env, user, tripMatch[1], await readJson(request));
    if (method === "DELETE") return deleteTrip(env, user, tripMatch[1]);
  }

  if (path === "/api/map" && method === "GET") return getMap(env, user);

  throw new HttpError(404, "Not found.", "not_found");
}

export default {
  async fetch(request, env, ctx): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/api/")) {
      try {
        return await handleApi(request, env, ctx);
      } catch (err) {
        return errorResponse(err);
      }
    }
    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;
