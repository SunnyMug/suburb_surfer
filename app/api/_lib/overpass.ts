/**
 * Shared OpenStreetMap Overpass API utilities.
 * Queries multiple Overpass mirrors concurrently in parallel for resilience and minimum latency.
 */

export const OVERPASS_ENDPOINTS = [
  "https://lz4.overpass-api.de/api/interpreter",
  "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
  "https://overpass-api.de/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
  "https://overpass.openstreetmap.fr/api/interpreter",
];

export const OVERPASS_TIMEOUT_MS = 8_000;
export const USER_AGENT = "SuburbSurfer/1.0 (educational project; contact@suburbsurfer.internal)";

/**
 * Races all configured Overpass mirrors concurrently, returning the parsed JSON
 * response from the first mirror that responds successfully.
 */
export async function queryOverpassInParallel(
  query: string,
  timeoutMs: number = OVERPASS_TIMEOUT_MS
): Promise<any> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  const fetchEndpoint = async (endpoint: string): Promise<any> => {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": USER_AGENT,
      },
      body: `data=${encodeURIComponent(query)}`,
      signal: controller.signal,
    });

    if (!res.ok) {
      throw new Error(`status ${res.status}`);
    }

    const text = await res.text();
    if (text.trimStart().startsWith("<")) {
      throw new Error("XML error response");
    }

    const data = JSON.parse(text);
    if (!data.elements) {
      throw new Error("No elements in Overpass response");
    }
    return data;
  };

  try {
    const data = await Promise.any(
      OVERPASS_ENDPOINTS.map((endpoint) => fetchEndpoint(endpoint))
    );
    controller.abort();
    clearTimeout(timer);
    return data;
  } catch (err) {
    clearTimeout(timer);
    logOverpassFailures(err);
    return null;
  }
}

/**
 * Logs why each mirror failed when every Overpass endpoint rejects, so that
 * mirror outages are visible in the server logs instead of silently returning nothing.
 */
export function logOverpassFailures(err: unknown): void {
  const reasons = err instanceof AggregateError ? err.errors : [err];
  const detail = OVERPASS_ENDPOINTS.map((endpoint, i) => {
    const reason = reasons[i];
    const message = reason instanceof Error ? reason.message : String(reason ?? "unknown error");
    return `${new URL(endpoint).host}: ${message}`;
  }).join("; ");
  console.warn(`[osm] all Overpass mirrors failed (${detail})`);
}
