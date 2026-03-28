/**
 * Venue data sourcing with automatic fallback:
 *   1. Foursquare Places Pro API  — if FOURSQUARE_API_KEY is set
 *   2. OpenStreetMap Overpass API — free, no key, always available
 *
 * Both return the same FsqVenue shape so callers are unaffected.
 */

// ─── Shared ──────────────────────────────────────────────────────────────────

export interface FsqVenue {
  name: string;
  category: string;
}

const NOMINATIM_TIMEOUT_MS = 5_000;
const OVERPASS_TIMEOUT_MS  = 12_000;
const FSQ_TIMEOUT_MS       = 5_000;
const MAX_VENUES = 15;
const USER_AGENT = "SuburbSurfer/1.0 (educational project)";

// Try multiple Overpass endpoints in order — any one can be overloaded.
const OVERPASS_ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
  "https://overpass.openstreetmap.ru/api/interpreter",
];

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

// ─── Foursquare Places Pro ────────────────────────────────────────────────────

const FSQ_SEARCH = "https://places-api.foursquare.com/places/search";
const FSQ_API_VERSION = "2025-06-17";
const FOOD_CATEGORY = "13000";

async function fetchViaFoursquare(
  suburb: string,
  city: string,
  apiKey: string
): Promise<FsqVenue[] | null> {
  const state = CITY_TO_STATE[city] ?? city;
  const near = `${suburb}, ${state}, Australia`;

  const params = new URLSearchParams({
    near,
    fsq_category_ids: FOOD_CATEGORY,
    limit: String(MAX_VENUES),
    fields: "name,categories",
    sort: "POPULARITY",
  });

  try {
    const res = await fetch(`${FSQ_SEARCH}?${params}`, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "X-Places-Api-Version": FSQ_API_VERSION,
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(FSQ_TIMEOUT_MS),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "(unreadable)");
      console.warn(`[foursquare] ${res.status} for "${near}" — ${body}`);
      return null;
    }

    const data = await res.json();
    const results: { name: string; categories?: { name: string }[] }[] =
      data?.results ?? [];

    const venues = results.map((place) => ({
      name: place.name,
      category: place.categories?.[0]?.name ?? "Restaurant",
    }));

    console.log(`[foursquare] found ${venues.length} venues for "${suburb}, ${city}"`);
    return venues;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[foursquare] request failed for "${near}" — ${msg}`);
    return null;
  }
}

// ─── OpenStreetMap Overpass ───────────────────────────────────────────────────

const NOMINATIM = "https://nominatim.openstreetmap.org/search";
const OVERPASS = "https://overpass-api.de/api/interpreter";

interface NominatimResult {
  boundingbox: [string, string, string, string]; // [minLat, maxLat, minLon, maxLon]
}

async function nominatimSearch(q: string): Promise<NominatimResult | null> {
  const params = new URLSearchParams({
    q,
    format: "json",
    limit: "1",
    countrycodes: "au",
  });

  try {
    const res = await fetch(`${NOMINATIM}?${params}`, {
      headers: { "User-Agent": USER_AGENT },
      signal: AbortSignal.timeout(NOMINATIM_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const results: NominatimResult[] = await res.json();
    return results[0] ?? null;
  } catch {
    return null;
  }
}

async function getBoundingBox(
  suburb: string,
  city: string
): Promise<[number, number, number, number] | null> {
  const state = CITY_TO_STATE[city] ?? city;

  // Try progressively broader queries until we get a bounding box.
  const attempts = [
    `${suburb}, ${city}, Australia`,
    `${suburb}, ${state}, Australia`,
    `${suburb}, Australia`,
  ];

  for (const q of attempts) {
    const result = await nominatimSearch(q);
    if (result) {
      const [minLat, maxLat, minLon, maxLon] = result.boundingbox.map(Number);
      console.log(`[osm] geocoded "${q}" → bbox ${minLat},${minLon},${maxLat},${maxLon}`);

      // For very small suburbs the bbox can be tiny — expand it slightly
      // (0.005° ≈ 500m) to catch venues just over the boundary.
      const pad = 0.005;
      return [minLat - pad, maxLat + pad, minLon - pad, maxLon + pad];
    }
  }

  return null;
}

async function fetchViaOSM(suburb: string, city: string): Promise<FsqVenue[]> {
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

      const data = await res.json();
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

      console.log(`[osm] found ${venues.length} venues for "${suburb}, ${city}" via ${endpoint}`);
      return venues;
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      console.warn(`[osm] ${endpoint} failed (${reason}) — trying next`);
    }
  }

  console.warn(`[osm] all Overpass endpoints failed for "${suburb}, ${city}"`);
  return [];
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Fetches real food & drink venues for a suburb.
 *
 * Priority:
 *   1. Foursquare Places Pro — if FOURSQUARE_API_KEY is set and reachable
 *   2. OpenStreetMap Overpass — free fallback, always attempted if FSQ fails
 *
 * Returns an empty array silently on total failure — callers should treat
 * this as optional context and proceed without it if empty.
 */
export async function fetchSuburbVenues(
  suburb: string,
  city: string
): Promise<FsqVenue[]> {
  const fsqKey = process.env.FOURSQUARE_API_KEY;

  if (fsqKey) {
    const fsqVenues = await fetchViaFoursquare(suburb, city, fsqKey);
    if (fsqVenues !== null && fsqVenues.length > 0) {
      return fsqVenues;
    }
    // null = error, empty = no coverage — either way fall through to OSM
    console.log(`[venues] foursquare unavailable or empty — falling back to OSM`);
  }

  return fetchViaOSM(suburb, city);
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
