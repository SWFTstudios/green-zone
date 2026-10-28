export const USER_AGENT = "GreenZone/0.2 (driving-for-dollars area insights)";

export class SourceError extends Error {
  constructor(
    public source: string,
    message: string,
  ) {
    super(`${source}: ${message}`);
  }
}

/** Fetches from a public data source with a timeout and an error that names the source. */
export async function fetchChecked(source: string, url: string, init: RequestInit = {}, timeoutMs = 25000): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(url, {
      ...init,
      headers: { "user-agent": USER_AGENT, ...(init.headers || {}) },
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    throw new SourceError(source, err instanceof Error && err.name === "TimeoutError" ? "timed out" : "unreachable");
  }
  // Census answers a missing or bad key with a redirect to an HTML page rather than an error status.
  if (res.redirected && /(missing|invalid)_key/i.test(res.url)) {
    throw new SourceError(source, "API key missing or invalid. Add a free key as the CENSUS_API_KEY secret.");
  }
  if (!res.ok) throw new SourceError(source, `HTTP ${res.status} ${(await res.text()).slice(0, 160).replace(/\s+/g, " ")}`);
  return res;
}

export async function fetchText(source: string, url: string, init: RequestInit = {}, timeoutMs = 25000): Promise<string> {
  return (await fetchChecked(source, url, init, timeoutMs)).text();
}

/** Fetches JSON from a public data source with a timeout and an error that names the source. */
export async function fetchJson<T>(source: string, url: string, init: RequestInit = {}, timeoutMs = 25000): Promise<T> {
  const text = await fetchText(source, url, { ...init, headers: { accept: "application/json", ...(init.headers || {}) } }, timeoutMs);
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new SourceError(source, `unexpected response ${text.slice(0, 160).replace(/\s+/g, " ")}`);
  }
}
