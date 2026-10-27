import { TransportSnapshot, TransportStop, TransitLineFeature, TransportType } from "../../../lib/types";
import { GeoData, isPointInPolygon } from "./foursquare";
import { queryOverpassInParallel } from "./overpass";

const TRANSPORT_QUERY_TIMEOUT_MS = 8_000;
// Search buffer (~800 metres in degrees) to discover stations immediately bordering the suburb
const BBOX_BUFFER_DEGREES = 0.007;
// Maximum distance (in metres) to include an external bordering station in the nearby snapshot
const MAX_BORDER_STOP_DISTANCE_METRES = 1_200;

/**
 * Calculates great-circle distance between two coordinate pairs using the Haversine formula.
 * Returns distance in metres.
 */
export function calculateDistanceMetres(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const R = 6371e3; // Earth's radius in metres
  const phi1 = (lat1 * Math.PI) / 180;
  const phi2 = (lat2 * Math.PI) / 180;
  const deltaPhi = ((lat2 - lat1) * Math.PI) / 180;
  const deltaLambda = ((lon2 - lon1) * Math.PI) / 180;

  const a =
    Math.sin(deltaPhi / 2) * Math.sin(deltaPhi / 2) +
    Math.cos(phi1) * Math.cos(phi2) * Math.sin(deltaLambda / 2) * Math.sin(deltaLambda / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return Math.round(R * c);
}

/**
 * Extracts and sanitises unique bus route codes from common OSM tags.
 */
export function extractBusRoutes(tags: Record<string, string>): string[] {
  const routesStr = tags.route_ref || tags.routes || tags.line || tags.bus_routes;
  if (!routesStr) return [];

  return routesStr
    .split(/[,;\/|]/)
    .map((r) => r.trim())
    .filter((r) => r.length > 0 && r.length < 15);
}

/**
 * Normalises station names to eliminate duplicate OSM nodes (e.g. separate platform nodes,
 * entrance nodes, or "Station" suffixes).
 */
function normaliseStopName(name: string): string {
  return name
    .toLowerCase()
    .replace(/\s+(railway station|train station|station|light rail stop|tram stop|ferry wharf|wharf|terminal)\b/gi, "")
    .trim();
}

/**
 * Formats a natural Australian English connectivity snapshot summary string.
 */
export function generateConnectivitySnapshot(counts: {
  trains: number;
  trams: number;
  ferries: number;
  busRoutes: number;
  busStops: number;
}): string {
  const parts: string[] = [];

  if (counts.trains > 0) {
    parts.push(`${counts.trains} train ${counts.trains === 1 ? "station" : "stations"}`);
  }
  if (counts.trams > 0) {
    parts.push(`${counts.trams} light rail ${counts.trams === 1 ? "stop" : "stops"}`);
  }
  if (counts.ferries > 0) {
    parts.push(`${counts.ferries} ferry ${counts.ferries === 1 ? "wharf" : "wharves"}`);
  }

  if (counts.busRoutes > 0) {
    parts.push(`${counts.busRoutes} bus ${counts.busRoutes === 1 ? "route" : "routes"}`);
  } else if (counts.busStops > 0 && parts.length === 0) {
    parts.push(`${counts.busStops} bus ${counts.busStops === 1 ? "stop" : "stops"}`);
  }

  if (parts.length === 0) {
    return "Limited direct public transport stops mapped; largely car dependent.";
  }

  if (parts.length === 1) {
    return `Served by ${parts[0]}.`;
  }
  if (parts.length === 2) {
    return `Served by ${parts[0]} and ${parts[1]}.`;
  }
  return `Served by ${parts.slice(0, -1).join(", ")}, and ${parts[parts.length - 1]}.`;
}

/**
 * Parses raw Overpass elements into structured TransportStop items, TransitLineFeature
 * geometries, and a compiled TransportSnapshot.
 */
export function parseTransportFromOsm(
  data: any,
  geo: GeoData
): TransportSnapshot {
  const elements = data?.elements || [];
  const rawStops: TransportStop[] = [];
  const lineFeatures: TransitLineFeature[] = [];
  const busRoutesSet = new Set<string>();
  let busStopCount = 0;

  for (const el of elements) {
    const tags: Record<string, string> = el.tags || {};

    // 1. Check for linear rail track geometries (heavy rail & light rail)
    if (el.type === "way" && Array.isArray(el.geometry) && el.geometry.length > 1) {
      const isTram = tags.railway === "tram" || tags.railway === "light_rail";
      const isRail = tags.railway === "rail" || tags.railway === "subway";

      if (isTram || isRail) {
        lineFeatures.push({
          type: "Feature",
          geometry: {
            type: "LineString",
            coordinates: el.geometry.map((pt: any) => [pt.lon, pt.lat]),
          },
          properties: {
            id: String(el.id),
            type: isTram ? "light_rail" : "rail",
            name: tags.name,
            ref: tags.ref,
          },
        });
      }
    }

    // 2. Parse transit stop points (nodes, ways, and relations)
    let lat: number | undefined = el.lat ?? el.center?.lat;
    let lng: number | undefined = el.lon ?? el.center?.lon;

    // Resolve centroid if way or relation has bounds or geometry array
    if (lat === undefined || lng === undefined) {
      if (el.bounds) {
        lat = (el.bounds.minlat + el.bounds.maxlat) / 2;
        lng = (el.bounds.minlon + el.bounds.maxlon) / 2;
      } else if (Array.isArray(el.geometry) && el.geometry.length > 0) {
        lat = el.geometry.reduce((acc: number, pt: any) => acc + pt.lat, 0) / el.geometry.length;
        lng = el.geometry.reduce((acc: number, pt: any) => acc + pt.lon, 0) / el.geometry.length;
      }
    }

    if (lat === undefined || lng === undefined) continue;

    let stopType: TransportType | null = null;
    if (tags.amenity === "ferry_terminal") {
      stopType = "ferry";
    } else if (
      tags.railway === "tram_stop" ||
      tags.station === "light_rail" ||
      tags.light_rail === "yes" ||
      tags.tram === "yes"
    ) {
      stopType = "tram";
    } else if (tags.railway === "station") {
      stopType = "train";
    } else if (tags.highway === "bus_stop" || tags.public_transport === "platform") {
      stopType = "bus";
    }

    if (!stopType) continue;

    // Bus stop handling: tally count and extract route references
    if (stopType === "bus") {
      busStopCount++;
      const routes = extractBusRoutes(tags);
      routes.forEach((r) => busRoutesSet.add(r));
      continue;
    }

    const name = tags.name || tags.ref || `${stopType.charAt(0).toUpperCase() + stopType.slice(1)} Stop`;
    const isInsideBoundary = geo.polygon
      ? isPointInPolygon([lng, lat], geo.polygon)
      : lat >= geo.bbox[0] && lat <= geo.bbox[1] && lng >= geo.bbox[2] && lng <= geo.bbox[3];

    const distanceMetres = calculateDistanceMetres(geo.lat, geo.lng, lat, lng);

    rawStops.push({
      id: `${stopType}-${el.id}`,
      name,
      type: stopType,
      lat,
      lng,
      distanceMetres,
      isInsideBoundary,
      routes: extractBusRoutes(tags),
    });
  }

  // Deduplicate multi-platform / multi-node stations by normalised name
  const deduplicatedStopsMap = new Map<string, TransportStop>();
  for (const stop of rawStops) {
    const key = `${stop.type}:${normaliseStopName(stop.name)}`;
    const existing = deduplicatedStopsMap.get(key);
    if (!existing) {
      deduplicatedStopsMap.set(key, stop);
    } else {
      // Prefer stops inside the suburb boundary or with shorter distance to centre
      if (!existing.isInsideBoundary && stop.isInsideBoundary) {
        deduplicatedStopsMap.set(key, stop);
      } else if (
        existing.isInsideBoundary === stop.isInsideBoundary &&
        (stop.distanceMetres ?? 0) < (existing.distanceMetres ?? 0)
      ) {
        deduplicatedStopsMap.set(key, stop);
      }
    }
  }

  const stops = Array.from(deduplicatedStopsMap.values()).sort((a, b) => {
    if (a.isInsideBoundary !== b.isInsideBoundary) {
      return a.isInsideBoundary ? -1 : 1;
    }
    return (a.distanceMetres ?? 0) - (b.distanceMetres ?? 0);
  });

  const trainCount = stops.filter((s) => s.type === "train").length;
  const tramCount = stops.filter((s) => s.type === "tram").length;
  const ferryCount = stops.filter((s) => s.type === "ferry").length;

  const summary = generateConnectivitySnapshot({
    trains: trainCount,
    trams: tramCount,
    ferries: ferryCount,
    busRoutes: busRoutesSet.size,
    busStops: busStopCount,
  });

  return {
    summary,
    trainCount,
    tramCount,
    ferryCount,
    busCount: busStopCount,
    busRouteCount: busRoutesSet.size,
    stops,
    lines: lineFeatures.length > 0 ? { type: "FeatureCollection", features: lineFeatures } : undefined,
  };
}

/**
 * Queries Overpass API for nearby train stations, light rail / tram stops, ferry wharves,
 * bus stops, and railway track geometries for a suburb.
 */
export async function fetchSuburbTransport(
  suburb: string,
  city: string,
  geo: GeoData | null
): Promise<TransportSnapshot | null> {
  if (!geo) return null;

  const [minLat, maxLat, minLon, maxLon] = geo.bbox;
  // Apply a small spatial buffer to discover border stations and connecting railway tracks
  const bufferedBbox = `${minLat - BBOX_BUFFER_DEGREES},${minLon - BBOX_BUFFER_DEGREES},${maxLat + BBOX_BUFFER_DEGREES},${maxLon + BBOX_BUFFER_DEGREES}`;

  const query = `[out:json][timeout:8];(
    node["railway"="station"](${bufferedBbox});
    way["railway"="station"](${bufferedBbox});
    relation["railway"="station"](${bufferedBbox});
    node["railway"="tram_stop"](${bufferedBbox});
    way["railway"="tram_stop"](${bufferedBbox});
    node["station"="light_rail"](${bufferedBbox});
    node["amenity"="ferry_terminal"](${bufferedBbox});
    way["amenity"="ferry_terminal"](${bufferedBbox});
    node["highway"="bus_stop"](${bufferedBbox});
    way["railway"~"^(rail|subway|light_rail|tram)$"](${bufferedBbox});
  );out center geom;`;

  console.log(`[osm] querying Overpass transit data for "${suburb}, ${city}"`);
  const data = await queryOverpassInParallel(query, TRANSPORT_QUERY_TIMEOUT_MS);
  if (!data) {
    console.warn(`[osm] Overpass transit query failed for "${suburb}, ${city}"`);
    return null;
  }

  const snapshot = parseTransportFromOsm(data, geo);
  console.log(
    `[osm] transit snapshot for "${suburb}, ${city}": ${snapshot.summary} (${snapshot.stops.length} stops, ${snapshot.lines?.features.length ?? 0} line segments)`
  );
  return snapshot;
}
