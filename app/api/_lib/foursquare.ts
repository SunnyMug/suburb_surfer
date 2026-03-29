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
  cuisine?: string;
}

const NOMINATIM = "https://nominatim.openstreetmap.org/search";
const OVERPASS_ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
  "https://overpass.openstreetmap.ru/api/interpreter",
];

const NOMINATIM_TIMEOUT_MS = 5_000;
// Fail fast on each Overpass endpoint — 3 endpoints × 5s = 15s max wait before
// surfacing the "venue data unavailable" notice. Previously 12s × 3 = 36s.
const OVERPASS_TIMEOUT_MS  = 5_000;
// Fetch a larger pool so we can score and surface the best-documented venues.
const FETCH_LIMIT = 40;
const MAX_VENUES  = 15;
const USER_AGENT  = "SuburbSurfer/1.0 (educational project)";

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

// Preference order for Nominatim result types — higher = better.
// "administrative" often matches the LGA boundary (huge area) rather than
// the suburb itself, so it scores lowest among area types.
const TYPE_PRIORITY: Record<string, number> = {
  suburb:        10,
  neighbourhood:  9,
  residential:    8,
  hamlet:         7,
  quarter:        6,
  city_district:  5,
  village:        4,
  town:           3,
  municipality:   2,
  administrative: 1,
};

// If a Nominatim result's bbox exceeds this in either dimension it's almost
// certainly an LGA/district boundary rather than a suburb (~16 km threshold).
const MAX_BBOX_DEGREES = 0.15;

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

    // Only consider geographic area types — aerodromes, POIs, buildings etc.
    // are excluded. Among qualifying results, return the most specific type.
    const areaResults = results.filter((r) => r.type in TYPE_PRIORITY);
    if (areaResults.length === 0) return null;
    return areaResults.sort(
      (a, b) => (TYPE_PRIORITY[b.type] ?? 0) - (TYPE_PRIORITY[a.type] ?? 0)
    )[0];
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
    if (!result) continue;

    const [minLat, maxLat, minLon, maxLon] = result.boundingbox.map(Number);
    const width  = maxLon - minLon;
    const height = maxLat - minLat;

    if (width > MAX_BBOX_DEGREES || height > MAX_BBOX_DEGREES) {
      // Bounding box is too large — almost certainly an LGA or district boundary.
      // Try the next, more specific query instead.
      console.warn(
        `[osm] bbox for "${q}" too large (${width.toFixed(3)}°×${height.toFixed(3)}°, type: ${result.type}) — skipping`
      );
      continue;
    }

    const pad = 0.005; // ~500m expansion to catch venues just over the boundary
    console.log(`[osm] geocoded "${q}" (type: ${result.type})`);
    return [minLat - pad, maxLat + pad, minLon - pad, maxLon + pad];
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
  // Fetch a larger pool; we score and trim to MAX_VENUES in application code.
  const query = `[out:json][timeout:4];(node["amenity"~"^(restaurant|cafe|bar|fast_food)$"](${bboxStr});way["amenity"~"^(restaurant|cafe|bar|fast_food)$"](${bboxStr}););out body ${FETCH_LIMIT};`;

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
      const raw: Array<{ venue: FsqVenue; score: number }> = [];

      for (const el of data.elements ?? []) {
        const tags: Record<string, string> = el.tags ?? {};
        const name = tags.name;
        if (!name) continue;

        const amenity = tags.amenity ?? "restaurant";
        const category =
          amenity === "cafe" ? "Café"
          : amenity === "bar" ? "Bar"
          : amenity === "fast_food" ? "Fast Food"
          : "Restaurant";

        // Score by data completeness — well-documented venues tend to be
        // more established. Ways (polygons) are usually larger permanent venues.
        let score = el.type === "way" ? 2 : 0;
        if (tags.cuisine)                                    score += 3;
        if (tags.website || tags["contact:website"])         score += 2;
        if (tags.phone   || tags["contact:phone"])           score += 1;
        if (tags.opening_hours)                              score += 1;
        if (tags["addr:street"] || tags["addr:housenumber"]) score += 1;

        const cuisine = tags.cuisine?.replace(/;.*/, "").trim(); // first value only
        raw.push({ venue: { name, category, ...(cuisine ? { cuisine } : {}) }, score });
      }

      // Sort best-documented first, deduplicate by name, take top MAX_VENUES.
      const seen = new Set<string>();
      const venues: FsqVenue[] = raw
        .sort((a, b) => b.score - a.score)
        .filter(({ venue }) => {
          const key = venue.name.toLowerCase();
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        })
        .slice(0, MAX_VENUES)
        .map(({ venue }) => venue);

      console.log(`[osm] found ${venues.length} venues for "${suburb}, ${city}" (pool: ${raw.length})`);
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

  const list = venues
    .map((v) => {
      const detail = v.cuisine ? `${v.category} · ${v.cuisine}` : v.category;
      return `• ${v.name} (${detail})`;
    })
    .join("\n");

  return `VERIFIED DINING DIRECTORY — ${venues.length} real food & drink venues confirmed for ${suburb}, ${city}:
${list}

STRICT RULE: You MUST only recommend venues from the above list. Use their exact names as written. Do NOT recommend any venue not on this list — not even one you believe exists. If the list has fewer than three entries, return only what is available. Fewer real recommendations is always better than invented ones.

`;
}
