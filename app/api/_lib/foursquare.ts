/**
 * Venue data sourcing via OpenStreetMap (Nominatim geocoding + Overpass query).
 * Free, no API key required.
 *
 * Note: Foursquare's v3 API (api.foursquare.com/v3) returned 410 Gone —
 * the endpoint is deprecated. Their new Places Pro API requires a paid account.
 * OSM provides equivalent coverage for Australian suburbs at no cost.
 */

export interface FsqVenue {
  name: string;
  category: string;
}

const NOMINATIM = "https://nominatim.openstreetmap.org/search";
const OVERPASS_ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
  "https://overpass.openstreetmap.ru/api/interpreter",
];

const NOMINATIM_TIMEOUT_MS = 5_000;
const OVERPASS_TIMEOUT_MS  = 12_000;
const MAX_VENUES = 15;
const USER_AGENT = "SuburbSurfer/1.0 (educational project)";

const CITY_TO_STATE: Record<string, string> = {
  Sydney: "New South Wales",
  Melbourne: "Victoria",
  Brisbane: "Queensland",
  Perth: "Western Australia",
  Adelaide: "South Australia",
  Canberra: "Australian Capital Territory",
  Hobart: "Tasmania",
  Darwin: "Northern Territory",
};

interface NominatimResult {
  boundingbox: [string, string, string, string]; // [minLat, maxLat, minLon, maxLon]
  type: string;
  display_name: string;
}

// Geographic area types — anything not in this set is a point of interest
// (station, building, etc.) whose bounding box is too small to be useful.
const AREA_TYPES = new Set([
  "suburb", "neighbourhood", "quarter", "city_district",
  "village", "town", "municipality", "administrative",
  "residential", "hamlet",
]);

async function nominatimSearch(q: string): Promise<NominatimResult | null> {
  const params = new URLSearchParams({
    q,
    format: "json",
    limit: "5",
    countrycodes: "au",
  });

  try {
    const res = await fetch(`${NOMINATIM}?${params}`, {
      headers: { "User-Agent": USER_AGENT },
      signal: AbortSignal.timeout(NOMINATIM_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const results: NominatimResult[] = await res.json();
    // Prefer geographic area types; fall back to first result if none match.
    return results.find((r) => AREA_TYPES.has(r.type)) ?? results[0] ?? null;
  } catch {
    return null;
  }
}

async function getBoundingBox(
  suburb: string,
  city: string
): Promise<[number, number, number, number] | null> {
  const state = CITY_TO_STATE[city] ?? city;

  for (const q of [
    `${suburb}, ${city}, Australia`,
    `${suburb}, ${state}, Australia`,
    `${suburb}, Australia`,
  ]) {
    const result = await nominatimSearch(q);
    if (result) {
      const [minLat, maxLat, minLon, maxLon] = result.boundingbox.map(Number);
      console.log(`[osm] geocoded "${q}" (type: ${result.type})`);
      const pad = 0.005; // ~500m expansion to catch venues just over the boundary
      return [minLat - pad, maxLat + pad, minLon - pad, maxLon + pad];
    }
  }

  return null;
}

/**
 * Fetches real food & drink venues for a suburb via OpenStreetMap.
 * Returns an empty array silently on failure — callers should treat this
 * as optional context and proceed without it if empty.
 */
export async function fetchSuburbVenues(
  suburb: string,
  city: string
): Promise<FsqVenue[]> {
  const bbox = await getBoundingBox(suburb, city);
  if (!bbox) {
    console.warn(`[osm] could not geocode "${suburb}, ${city}"`);
    return [];
  }

  const [minLat, maxLat, minLon, maxLon] = bbox;
  const bboxStr = `${minLat},${minLon},${maxLat},${maxLon}`;
  const query = `[out:json][timeout:12];(node["amenity"~"^(restaurant|cafe|bar|fast_food)$"](${bboxStr});way["amenity"~"^(restaurant|cafe|bar|fast_food)$"](${bboxStr}););out body ${MAX_VENUES};`;

  for (const endpoint of OVERPASS_ENDPOINTS) {
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: `data=${encodeURIComponent(query)}`,
        signal: AbortSignal.timeout(OVERPASS_TIMEOUT_MS),
      });

      if (!res.ok) {
        console.warn(`[osm] ${endpoint} returned ${res.status} — trying next`);
        continue;
      }

      const text = await res.text();
      if (text.trimStart().startsWith("<")) {
        // Overpass returned XML — server-side error (rate limit, memory, etc.)
        console.warn(`[osm] ${endpoint} returned XML error — trying next`);
        continue;
      }

      const data = JSON.parse(text);
      const venues: FsqVenue[] = [];

      for (const el of data.elements ?? []) {
        const name = el.tags?.name;
        if (!name) continue;
        const amenity: string = el.tags?.amenity ?? "restaurant";
        const category =
          amenity === "cafe" ? "Café"
          : amenity === "bar" ? "Bar"
          : amenity === "fast_food" ? "Fast Food"
          : "Restaurant";
        venues.push({ name, category });
      }

      console.log(`[osm] found ${venues.length} venues for "${suburb}, ${city}"`);
      return venues;
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      console.warn(`[osm] ${endpoint} failed (${reason}) — trying next`);
    }
  }

  console.warn(`[osm] all Overpass endpoints failed for "${suburb}, ${city}"`);
  return [];
}

/**
 * Formats a venue list into a prompt context block.
 * Returns an empty string if venues is empty.
 */
export function buildVenueContext(
  venues: FsqVenue[],
  suburb: string,
  city: string
): string {
  if (venues.length === 0) return "";

  const list = venues.map((v) => `• ${v.name} (${v.category})`).join("\n");

  return `VERIFIED DINING DIRECTORY — ${venues.length} real food & drink venues confirmed for ${suburb}, ${city}:
${list}

STRICT RULE: You MUST only recommend venues from the above list. Use their exact names as written. Do NOT recommend any venue not on this list — not even one you believe exists. If the list has fewer than three entries, return only what is available. Fewer real recommendations is always better than invented ones.

`;
}
