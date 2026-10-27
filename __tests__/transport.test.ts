import { describe, it, expect } from "vitest";
import {
  calculateDistanceMetres,
  extractBusRoutes,
  generateConnectivitySnapshot,
  parseTransportFromOsm,
} from "../app/api/_lib/transport";
import { GeoData } from "../app/api/_lib/foursquare";

describe("calculateDistanceMetres", () => {
  it("computes accurate distance between known Sydney coordinates", () => {
    // Central Station (-33.883, 151.206) to Redfern Station (-33.892, 151.198) ~ 1.25 km
    const dist = calculateDistanceMetres(-33.883, 151.206, -33.892, 151.198);
    expect(dist).toBeGreaterThan(1100);
    expect(dist).toBeLessThan(1400);
  });

  it("returns 0 for identical coordinates", () => {
    expect(calculateDistanceMetres(-33.85, 151.2, -33.85, 151.2)).toBe(0);
  });
});

describe("extractBusRoutes", () => {
  it("splits multiple route designations correctly", () => {
    expect(extractBusRoutes({ route_ref: "370; 372; M20" })).toEqual(["370", "372", "M20"]);
    expect(extractBusRoutes({ routes: "423, 426, 428" })).toEqual(["423", "426", "428"]);
    expect(extractBusRoutes({ line: "100 / 101" })).toEqual(["100", "101"]);
  });

  it("returns empty array when no route tags exist", () => {
    expect(extractBusRoutes({})).toEqual([]);
    expect(extractBusRoutes({ highway: "bus_stop" })).toEqual([]);
  });
});

describe("generateConnectivitySnapshot", () => {
  it("formats train stations and bus routes correctly", () => {
    const summary = generateConnectivitySnapshot({
      trains: 2,
      trams: 0,
      ferries: 0,
      busRoutes: 4,
      busStops: 12,
    });
    expect(summary).toBe("Served by 2 train stations and 4 bus routes.");
  });

  it("handles singular noun forms accurately", () => {
    const summary = generateConnectivitySnapshot({
      trains: 1,
      trams: 1,
      ferries: 1,
      busRoutes: 1,
      busStops: 2,
    });
    expect(summary).toBe("Served by 1 train station, 1 light rail stop, 1 ferry wharf, and 1 bus route.");
  });

  it("formats ferry wharves and bus stops accurately", () => {
    const summary = generateConnectivitySnapshot({
      trains: 0,
      trams: 0,
      ferries: 2,
      busRoutes: 0,
      busStops: 5,
    });
    expect(summary).toBe("Served by 2 ferry wharves.");
  });

  it("falls back to bus stops when no routes are specified", () => {
    const summary = generateConnectivitySnapshot({
      trains: 0,
      trams: 0,
      ferries: 0,
      busRoutes: 0,
      busStops: 8,
    });
    expect(summary).toBe("Served by 8 bus stops.");
  });

  it("provides helpful notice when no public transit stops are found", () => {
    const summary = generateConnectivitySnapshot({
      trains: 0,
      trams: 0,
      ferries: 0,
      busRoutes: 0,
      busStops: 0,
    });
    expect(summary).toContain("Limited direct public transport stops mapped; largely car dependent.");
  });
});

describe("parseTransportFromOsm", () => {
  const mockGeo: GeoData = {
    bbox: [-33.9, -33.88, 151.17, 151.19],
    lat: -33.89,
    lng: 151.18,
    osmType: "relation",
    osmId: 12345,
    polygon: {
      type: "Polygon",
      coordinates: [
        [
          [151.17, -33.9],
          [151.19, -33.9],
          [151.19, -33.88],
          [151.17, -33.88],
          [151.17, -33.9],
        ],
      ],
    },
  };

  it("parses and deduplicates train stations and wharves", () => {
    const mockOsmData = {
      elements: [
        // Newtown Station Platform 1
        {
          type: "node",
          id: 101,
          lat: -33.897,
          lon: 151.179,
          tags: { name: "Newtown Station", railway: "station" },
        },
        // Newtown Station Platform 2 (duplicate)
        {
          type: "node",
          id: 102,
          lat: -33.8971,
          lon: 151.1791,
          tags: { name: "Newtown", railway: "station" },
        },
        // Ferry Wharf
        {
          type: "node",
          id: 201,
          lat: -33.885,
          lon: 151.182,
          tags: { name: "Balmain Wharf", amenity: "ferry_terminal" },
        },
        // Bus stops with routes
        {
          type: "node",
          id: 301,
          lat: -33.892,
          lon: 151.181,
          tags: { highway: "bus_stop", route_ref: "370;423" },
        },
        {
          type: "node",
          id: 302,
          lat: -33.893,
          lon: 151.182,
          tags: { highway: "bus_stop", route_ref: "426;428" },
        },
        // Railway track geometry
        {
          type: "way",
          id: 401,
          tags: { railway: "rail", name: "Main Suburban Line" },
          geometry: [
            { lat: -33.896, lon: 151.178 },
            { lat: -33.897, lon: 151.179 },
            { lat: -33.898, lon: 151.18 },
          ],
        },
      ],
    };

    const snapshot = parseTransportFromOsm(mockOsmData, mockGeo);

    // Should deduplicate Newtown Station into 1 station
    expect(snapshot.trainCount).toBe(1);
    expect(snapshot.ferryCount).toBe(1);
    expect(snapshot.busCount).toBe(2);
    expect(snapshot.busRouteCount).toBe(4);
    expect(snapshot.summary).toBe("Served by 1 train station, 1 ferry wharf, and 4 bus routes.");

    // Line geometries
    expect(snapshot.lines).toBeDefined();
    expect(snapshot.lines?.features.length).toBe(1);
    expect(snapshot.lines?.features[0].properties.type).toBe("rail");
  });

  it("calculates centroid for stations mapped as ways with bounds", () => {
    const mockOsmWayData = {
      elements: [
        {
          type: "way",
          id: 585998416,
          bounds: {
            minlat: -33.893,
            minlon: 151.197,
            maxlat: -33.891,
            maxlon: 151.199,
          },
          tags: {
            name: "Redfern",
            railway: "station",
          },
        },
      ],
    };

    const snapshot = parseTransportFromOsm(mockOsmWayData, mockGeo);
    expect(snapshot.trainCount).toBe(1);
    expect(snapshot.stops[0].name).toBe("Redfern");
    expect(snapshot.stops[0].lat).toBeCloseTo(-33.892, 3);
    expect(snapshot.stops[0].lng).toBeCloseTo(151.198, 3);
  });
});
