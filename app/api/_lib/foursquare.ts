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

const TIMEOUT_MS = 5_000;
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
      signal: AbortSignal.timeout(TIMEOUT_MS),
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

async function getBoundingBox(
  suburb: string,
  city: string
): Promise<[number, number, number, number] | null> {
  const params = new URLSearchParams({
    q: `${suburb}, ${city}, Australia`,
    format: "json",
    limit: "1",
    featuretype: "settlement",
  });

  try {
    const res = await fetch(`${NOMINATIM}?${params}`, {
      headers: { "User-Agent": USER_AGENT },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    if (!res.ok) return null;
    const results: NominatimResult[] = await res.json();
    if (!results.length) return null;

    const [minLat, maxLat, minLon, maxLon] = results[0].boundingbox.map(Number);
    return [minLat, maxLat, minLon, maxLon];
  } catch {
    return null;
  }
}

async function fetchViaOSM(suburb: string, city: string): Promise<FsqVenue[]> {
  const bbox = await getBoundingBox(suburb, city);
  if (!bbox) {
    console.warn(`[osm] could not geocode "${suburb}, ${city}"`);
    return [];
  }

  const [minLat, maxLat, minLon, maxLon] = bbox;
  const bboxStr = `${minLat},${minLon},${maxLat},${maxLon}`;

  const query = `
[out:json][timeout:10];
(
  node["amenity"~"^(restaurant|cafe|bar|fast_food)$"](${bboxStr});
  way["amenity"~"^(restaurant|cafe|bar|fast_food)$"](${bboxStr});
);
out body ${MAX_VENUES};
`.trim();

  try {
    const res = await fetch(OVERPASS, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: `data=${encodeURIComponent(query)}`,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    if (!res.ok) return [];
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

    console.log(`[osm] found ${venues.length} venues for "${suburb}, ${city}"`);
    return venues;
  } catch {
    console.warn(`[osm] overpass query failed for "${suburb}, ${city}"`);
    return [];
  }
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

  return `VERIFIED DINING DIRECTORY — real food & drink venues confirmed for ${suburb}, ${city}:
${list}

For restaurant_recommendations: use exact venue names from this list. Do not invent names not on this list. If the list has fewer venues than required, you may supplement with venues you are highly confident are real, noting them with "(unverified)" in the description.

`;
}
