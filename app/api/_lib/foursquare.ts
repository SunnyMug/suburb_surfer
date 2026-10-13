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
  lat: number;
  lng: number;
}

const NOMINATIM = "https://nominatim.openstreetmap.org/search";
const OVERPASS_ENDPOINTS = [
  "https://lz4.overpass-api.de/api/interpreter",
  "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
  "https://overpass-api.de/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
];

const NOMINATIM_TIMEOUT_MS = 5_000;
// Parallel Overpass query timeout: race all endpoints concurrently
const OVERPASS_TIMEOUT_MS  = 8_000;
// Fetch a larger pool so we can score and surface the best-documented venues.
const FETCH_LIMIT = 50;
const MAX_VENUES  = 30;
const USER_AGENT  = "SuburbSurfer/1.0 (educational project; contact@suburbsurfer.internal)";

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
  class: string;
  display_name: string;
  name?: string;
  lat: string;
  lon: string;
  osm_type: string;
  osm_id: number;
  geojson?: {
    type: "Polygon" | "MultiPolygon";
    coordinates: any;
  };
}

// Preference order for Nominatim result types — higher = better.
// Note: "residential" is deliberately excluded because Nominatim classifies
// residential streets (highway=residential) as type "residential".
const TYPE_PRIORITY: Record<string, number> = {
  suburb:        10,
  neighbourhood:  9,
  quarter:        8,
  city_district:  7,
  hamlet:         6,
  village:        5,
  town:           4,
  municipality:   3,
  administrative: 2,
};

// If a Nominatim result's bbox exceeds this in either dimension it's almost
// certainly a whole metropolitan region or state (~35 km threshold).
const MAX_BBOX_DEGREES = 0.30;

async function nominatimSearch(
  q: string,
  suburbName: string
): Promise<NominatimResult | null> {
  const params = new URLSearchParams({
    q,
    format: "json",
    limit: "5",
    countrycodes: "au",
    polygon_geojson: "1",
  });

  try {
    const res = await fetch(`${NOMINATIM}?${params}`, {
      headers: { "User-Agent": USER_AGENT },
      signal: AbortSignal.timeout(NOMINATIM_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const text = await res.text();
    if (text.trimStart().startsWith("<")) return null;
    const results: NominatimResult[] = JSON.parse(text);

    // Only consider geographic area types — highways, railways, buildings etc. are excluded.
    const valid = results.filter((r) => {
      if (r.class === "highway" || r.class === "railway" || r.class === "building") return false;
      return (r.class === "place" || r.class === "boundary") && r.type in TYPE_PRIORITY;
    });

    if (valid.length === 0) return null;

    // Prefer exact suburb match and deprioritize LGA councils (e.g. "Lane Cove" vs "Lane Cove Municipal Council")
    const sorted = valid.sort((a, b) => {
      const aIsCouncil = /council|shire|municipality/i.test(a.display_name);
      const bIsCouncil = /council|shire|municipality/i.test(b.display_name);
      if (aIsCouncil !== bIsCouncil) return aIsCouncil ? 1 : -1;

      const aName = (a.name || "").toLowerCase();
      const bName = (b.name || "").toLowerCase();
      const target = suburbName.toLowerCase();
      const aExact = aName === target;
      const bExact = bName === target;
      if (aExact !== bExact) return aExact ? -1 : 1;

      return (TYPE_PRIORITY[b.type] ?? 0) - (TYPE_PRIORITY[a.type] ?? 0);
    });

    return sorted[0];
  } catch {
    return null;
  }
}

export interface GeoData {
  bbox: [number, number, number, number];
  lat: number;
  lng: number;
  osmType: string;
  osmId: number;
  polygon?: {
    type: "Polygon" | "MultiPolygon";
    coordinates: any;
  };
}

async function photonSearch(suburb: string, city: string): Promise<GeoData | null> {
  const state = CITY_TO_STATE[city] ?? city;
  for (const q of [`${suburb}, ${city}, Australia`, `${suburb}, ${state}, Australia`]) {
    try {
      const res = await fetch(`https://photon.komoot.io/api/?q=${encodeURIComponent(q)}&limit=1`, {
        signal: AbortSignal.timeout(4000),
      });
      if (!res.ok) continue;
      const data = await res.json();
      const f = data.features?.[0];
      if (!f?.geometry?.coordinates) continue;
      const [lon, lat] = f.geometry.coordinates;
      let minLat = lat - 0.015;
      let maxLat = lat + 0.015;
      let minLon = lon - 0.015;
      let maxLon = lon + 0.015;

      if (Array.isArray(f.properties?.extent) && f.properties.extent.length === 4) {
        const [eMinLon, eMaxLat, eMaxLon, eMinLat] = f.properties.extent;
        minLat = Math.min(eMinLat, eMaxLat);
        maxLat = Math.max(eMinLat, eMaxLat);
        minLon = Math.min(eMinLon, eMaxLon);
        maxLon = Math.max(eMinLon, eMaxLon);
      }

      console.log(`[osm] geocoded "${suburb}, ${city}" via Photon fallback (lat: ${lat}, lng: ${lon})`);
      return {
        bbox: [minLat, maxLat, minLon, maxLon],
        lat,
        lng: lon,
        osmType: f.properties?.osm_type ?? "node",
        osmId: f.properties?.osm_id ?? 0,
      };
    } catch {
      continue;
    }
  }
  return null;
}

async function openMeteoSearch(suburb: string, city: string): Promise<GeoData | null> {
  try {
    const res = await fetch(
      `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(suburb)}&count=5&language=en&format=json`,
      { signal: AbortSignal.timeout(3000) }
    );
    if (!res.ok) return null;
    const data = await res.json();
    const results = data.results ?? [];
    const match = results.find((r: any) => r.country_code === "AU") ?? results[0];
    if (!match?.latitude || !match?.longitude) return null;
    const lat = match.latitude;
    const lng = match.longitude;
    const pad = 0.015;
    console.log(`[osm] geocoded "${suburb}, ${city}" via Open-Meteo fallback (lat: ${lat}, lng: ${lng})`);
    return {
      bbox: [lat - pad, lat + pad, lng - pad, lng + pad],
      lat,
      lng,
      osmType: "node",
      osmId: match.id ?? 0,
    };
  } catch {
    return null;
  }
}

async function getGeoData(
  suburb: string,
  city: string
): Promise<GeoData | null> {
  const state = CITY_TO_STATE[city] ?? city;

  // Search candidates: test state first for ACT/Canberra and state disambiguation, then city
  for (const q of [
    `${suburb}, ${state}, Australia`,
    `${suburb}, ${city}, Australia`,
    `${suburb}, Australia`,
  ]) {
    const result = await nominatimSearch(q, suburb);
    if (!result) continue;

    const [minLat, maxLat, minLon, maxLon] = result.boundingbox.map(Number);
    const width  = maxLon - minLon;
    const height = maxLat - minLat;

    if (width > MAX_BBOX_DEGREES || height > MAX_BBOX_DEGREES) {
      console.warn(
        `[osm] bbox for "${q}" too large (${width.toFixed(3)}°×${height.toFixed(3)}°, type: ${result.type}) — skipping`
      );
      continue;
    }

    const hasPolygon =
      result.geojson &&
      (result.geojson.type === "Polygon" || result.geojson.type === "MultiPolygon");

    // Do not pad bounding box when official boundary polygon exists, preventing venues in adjacent suburbs from bleeding in
    const pad = hasPolygon ? 0 : 0.002;
    console.log(`[osm] geocoded "${q}" (type: ${result.type}, osm_type: ${result.osm_type}, osm_id: ${result.osm_id}, hasPolygon: ${Boolean(hasPolygon)})`);

    return {
      bbox: [minLat - pad, maxLat + pad, minLon - pad, maxLon + pad],
      lat: Number(result.lat),
      lng: Number(result.lon),
      osmType: result.osm_type,
      osmId: result.osm_id,
      polygon: hasPolygon ? result.geojson : undefined,
    };
  }

  // Fallback 1: Photon (Komoot OSM) when Nominatim returns 429 or is rate-limited
  const photon = await photonSearch(suburb, city);
  if (photon) return photon;

  // Fallback 2: Open-Meteo geocoding
  const openMeteo = await openMeteoSearch(suburb, city);
  if (openMeteo) return openMeteo;

  return null;
}

/**
 * Ray-casting point-in-polygon containment test for GeoJSON Polygon and MultiPolygon geometries.
 * Point is in [lng, lat] coordinate format.
 */
function isPointInRing(lng: number, lat: number, ring: [number, number][]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0];
    const yi = ring[i][1];
    const xj = ring[j][0];
    const yj = ring[j][1];

    const intersect = yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

export function isPointInPolygon(
  point: [number, number],
  geometry?: { type: string; coordinates: any }
): boolean {
  if (!geometry || !geometry.coordinates || !geometry.type) return true;
  const [lng, lat] = point;

  if (geometry.type === "Polygon") {
    const rings = geometry.coordinates;
    if (!rings || rings.length === 0) return true;
    if (!isPointInRing(lng, lat, rings[0])) return false;
    // Ensure point does not sit within an interior exclusion ring (hole)
    for (let i = 1; i < rings.length; i++) {
      if (isPointInRing(lng, lat, rings[i])) return false;
    }
    return true;
  }

  if (geometry.type === "MultiPolygon") {
    const polygons = geometry.coordinates;
    if (!polygons || polygons.length === 0) return true;
    for (const rings of polygons) {
      if (rings && rings.length > 0 && isPointInRing(lng, lat, rings[0])) {
        let inHole = false;
        for (let i = 1; i < rings.length; i++) {
          if (isPointInRing(lng, lat, rings[i])) {
            inHole = true;
            break;
          }
        }
        if (!inHole) return true;
      }
    }
    return false;
  }

  return true;
}

function parseVenuesFromOsmData(data: any, targetSuburb?: string): FsqVenue[] {
  const raw: Array<{ venue: FsqVenue; score: number }> = [];

  for (const el of data.elements ?? []) {
    const tags: Record<string, string> = el.tags ?? {};
    const name = tags.name;
    if (!name) continue;

    // If venue explicitly tags an address suburb that disagrees with target, skip it
    const addrSuburb = tags["addr:suburb"]?.trim().toLowerCase();
    if (addrSuburb && targetSuburb) {
      const target = targetSuburb.toLowerCase();
      if (addrSuburb !== target && !addrSuburb.includes(target) && !target.includes(addrSuburb)) {
        continue;
      }
    }

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
    
    const lat = el.lat ?? el.center?.lat;
    const lng = el.lon ?? el.center?.lon;
    
    if (lat !== undefined && lng !== undefined) {
      raw.push({ 
        venue: { name, category, lat, lng, ...(cuisine ? { cuisine } : {}) }, 
        score 
      });
    }
  }

  // Sort best-documented first, deduplicate by name, take top MAX_VENUES.
  const seen = new Set<string>();
  return raw
    .sort((a, b) => b.score - a.score)
    .filter(({ venue }) => {
      const key = venue.name.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, MAX_VENUES)
    .map(({ venue }) => venue);
}

async function fetchOverpassInParallel(
  query: string,
  timeoutMs: number = OVERPASS_TIMEOUT_MS,
  targetSuburb?: string
): Promise<FsqVenue[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  const fetchEndpoint = async (endpoint: string): Promise<FsqVenue[]> => {
    try {
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
      const venues = parseVenuesFromOsmData(data, targetSuburb);
      if (venues.length === 0) {
        throw new Error("No venues found");
      }
      return venues;
    } catch (err) {
      throw err;
    }
  };

  try {
    const venues = await Promise.any(
      OVERPASS_ENDPOINTS.map((endpoint) => fetchEndpoint(endpoint))
    );
    controller.abort();
    clearTimeout(timer);
    return venues;
  } catch {
    clearTimeout(timer);
    return [];
  }
}

/**
 * Fetches both the spatial geo metadata (centre, bounding box, polygon boundary)
 * and verified dining venues for a suburb via OpenStreetMap.
 */
export async function fetchSuburbGeoAndVenues(
  suburb: string,
  city: string
): Promise<{ venues: FsqVenue[]; geo: GeoData | null }> {
  const geo = await getGeoData(suburb, city);
  if (!geo) {
    console.warn(`[osm] could not geocode "${suburb}, ${city}"`);
    return { venues: [], geo: null };
  }

  const { bbox, lat, lng } = geo;
  const [minLat, maxLat, minLon, maxLon] = bbox;
  const bboxStr = `${minLat},${minLon},${maxLat},${maxLon}`;

  // Spatial bounding box query is universally supported across all Overpass mirrors
  const bboxQuery = `[out:json][timeout:8];(node["amenity"~"^(restaurant|cafe|bar|fast_food)$"](${bboxStr});way["amenity"~"^(restaurant|cafe|bar|fast_food)$"](${bboxStr}););out center ${FETCH_LIMIT};`;

  console.log(`[osm] querying Overpass endpoints in parallel for "${suburb}, ${city}"`);
  let venues = await fetchOverpassInParallel(bboxQuery, OVERPASS_TIMEOUT_MS, suburb);

  // If bounding box had 0 venues (e.g. very small or purely residential suburb),
  // fallback to a tighter radius query around the suburb's centre coordinates
  if (venues.length === 0 && !isNaN(lat) && !isNaN(lng)) {
    console.log(`[osm] bbox returned no venues, retrying with 1000m radius around (${lat}, ${lng}) for "${suburb}, ${city}"`);
    const radiusQuery = `[out:json][timeout:8];(node(around:1000,${lat},${lng})["amenity"~"^(restaurant|cafe|bar|fast_food)$"];way(around:1000,${lat},${lng})["amenity"~"^(restaurant|cafe|bar|fast_food)$"];);out center ${FETCH_LIMIT};`;
    venues = await fetchOverpassInParallel(radiusQuery, 6_000, suburb);
  }

  // Strictly filter venues to ensure they reside within the official suburb boundary polygon
  if (geo.polygon && venues.length > 0) {
    const strictlyInside = venues.filter((v) => isPointInPolygon([v.lng, v.lat], geo.polygon));
    console.log(
      `[osm] polygon boundary filter: kept ${strictlyInside.length} of ${venues.length} venues within "${suburb}"`
    );
    if (strictlyInside.length > 0) {
      venues = strictlyInside;
    }
  }

  if (venues.length > 0) {
    console.log(`[osm] found ${venues.length} verified venues strictly inside "${suburb}, ${city}"`);
  } else {
    console.warn(`[osm] all Overpass endpoints failed or returned no venues for "${suburb}, ${city}"`);
  }

  return { venues, geo };
}

/**
 * Fetches real food & drink venues for a suburb via OpenStreetMap.
 * Queries multiple Overpass mirrors concurrently in parallel for minimum latency.
 * Returns an empty array silently on failure.
 */
export async function fetchSuburbVenues(
  suburb: string,
  city: string
): Promise<FsqVenue[]> {
  const result = await fetchSuburbGeoAndVenues(suburb, city);
  return result.venues;
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
