import { areaStatus, queryAreas } from "./areas";
import { ZILLOW_DATASETS, importZillowDataset, refreshStaleZillow, staleDatasets } from "./areas/zillow";
import { cleanupGuests, currentUser, logout, requestCode, requireUser, startGuest, verifyCode } from "./auth";
import { HttpError, assertSameOrigin, errorResponse, json, readJson, sha256Hex } from "./http";
import { createSearch, deleteSearch, getSearch, listSearches, updateSearch } from "./searches";
import { createTrip, deleteTrip, getMap, getTrip, listTrips, updateTrip } from "./trips";
import { createZone, deleteZone, listZones, updateZone } from "./zones";

/** POST /api/admin/zillow-import?dataset=<id|next>, authorized with `Authorization: Bearer <ADMIN_TOKEN>`. */
async function adminZillowImport(request: Request, env: Env, url: URL): Promise<Response> {
  const header = request.headers.get("authorization") || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!env.ADMIN_TOKEN) throw new HttpError(404, "Not found.", "not_found");
  if (!token || (await sha256Hex(token)) !== (await sha256Hex(env.ADMIN_TOKEN))) {
    throw new HttpError(401, "Bad admin token.", "unauthorized");
  }
  const wanted = url.searchParams.get("dataset") || "next";
  const dataset = wanted === "next" ? (await staleDatasets(env))[0] : ZILLOW_DATASETS.find((d) => d.id === wanted);
  if (!dataset) {
    return json({ ok: true, message: wanted === "next" ? "All Zillow datasets are up to date." : "Unknown dataset.", datasets: ZILLOW_DATASETS.map((d) => d.id) });
  }
  const result = await importZillowDataset(env, dataset);
  return json({ ...result, remaining: (await staleDatasets(env)).map((d) => d.id) }, { status: result.ok ? 200 : 502 });
}

async function handleApi(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, "");
  const method = request.method;

  if (path === "/api/admin/zillow-import" && method === "POST") return adminZillowImport(request, env, url);

  assertSameOrigin(request);

  if (path === "/api/auth/request" && method === "POST") return requestCode(request, env, await readJson(request));
  if (path === "/api/auth/verify" && method === "POST") return verifyCode(request, env, ctx, await readJson(request));
  if (path === "/api/auth/logout" && method === "POST") return logout(request, env);
  if (path === "/api/auth/guest" && method === "POST") return startGuest(request, env);

  if (path === "/api/me" && method === "GET") {
    const user = await currentUser(request, env);
    return json({
      user: user && {
        id: user.id,
        email: user.isGuest ? null : user.email,
        plan: user.plan,
        createdAt: user.createdAt,
        isGuest: user.isGuest,
      },
    });
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

  if (path === "/api/areas" && method === "POST") return queryAreas(request, env, user);
  if (path === "/api/areas/status" && method === "GET") return areaStatus(env);

  if (path === "/api/searches") {
    if (method === "GET") return listSearches(env, user);
    if (method === "POST") return createSearch(env, user, await readJson(request));
  }
  const searchMatch = path.match(/^\/api\/searches\/([\w-]+)$/);
  if (searchMatch) {
    if (method === "GET") return getSearch(env, user, searchMatch[1]);
    if (method === "PATCH") return updateSearch(env, user, searchMatch[1], await readJson(request));
    if (method === "DELETE") return deleteSearch(env, user, searchMatch[1]);
  }

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

  async scheduled(_controller, env, ctx): Promise<void> {
    ctx.waitUntil(
      refreshStaleZillow(env).then((results) => {
        for (const r of results) console.log(`Zillow ${r.dataset}: ${r.ok ? `${r.rows} rows (${r.month})` : r.error}`);
      }),
    );
    ctx.waitUntil(cleanupGuests(env).then((n) => n && console.log(`Removed ${n} empty guest accounts`)));
  },
} satisfies ExportedHandler<Env>;
