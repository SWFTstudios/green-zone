export const USER_AGENT = "GreenZone/0.2 (driving-for-dollars area insights)";

export class SourceError extends Error {
  constructor(
    public source: string,
    message: string,
  ) {
    super(`${source}: ${message}`);
  }
}

/** Fetches JSON from a public data source with a timeout and an error that names the source. */
export async function fetchJson<T>(source: string, url: string, init: RequestInit = {}, timeoutMs = 25000): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      ...init,
      headers: { "user-agent": USER_AGENT, accept: "application/json", ...(init.headers || {}) },
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    throw new SourceError(source, err instanceof Error && err.name === "TimeoutError" ? "timed out" : "unreachable");
  }
  const text = await res.text();
  if (!res.ok) throw new SourceError(source, `HTTP ${res.status} ${text.slice(0, 160).replace(/\s+/g, " ")}`);
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new SourceError(source, `unexpected response ${text.slice(0, 160).replace(/\s+/g, " ")}`);
  }
}
