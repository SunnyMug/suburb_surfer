import { NextRequest, NextResponse } from "next/server";

/**
 * Full diagnostics for Wikipedia + Nominatim + Overpass.
 * Usage: GET /api/test-fsq?suburb=Harris+Park&city=Sydney
 * Remove before going to production.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const suburb = request.nextUrl.searchParams.get("suburb") ?? "Harris Park";
  const city   = request.nextUrl.searchParams.get("city")   ?? "Sydney";

  const CITY_TO_STATE: Record<string, string> = {
    Sydney: "New South Wales", Melbourne: "Victoria", Brisbane: "Queensland",
    Perth: "Western Australia", Adelaide: "South Australia",
    Canberra: "Australian Capital Territory", Hobart: "Tasmania", Darwin: "Northern Territory",
  };
  const state = CITY_TO_STATE[city] ?? city;

  // ── 1. Wikipedia ──────────────────────────────────────────────────────────
  const wikiAttempts = [`${suburb}, ${state}`, suburb];
  const wikiResults: Record<string, unknown> = {};

  for (const title of wikiAttempts) {
    const params = new URLSearchParams({
      action: "query", prop: "extracts", exintro: "true",
      explaintext: "true", titles: title, format: "json", redirects: "1",
    });
    try {
      const res = await fetch(`https://en.wikipedia.org/w/api.php?${params}`, {
        headers: { "User-Agent": "SuburbSurfer/1.0" },
        signal: AbortSignal.timeout(5000),
      });
      const data = await res.json();
      const page = Object.values(data?.query?.pages ?? {})[0] as Record<string, unknown>;
      wikiResults[title] = {
        status: res.status,
        missing: !!page?.missing,
        extractLength: typeof page?.extract === "string" ? page.extract.length : 0,
        extractPreview: typeof page?.extract === "string" ? page.extract.slice(0, 150) : null,
      };
    } catch (err) {
      wikiResults[title] = { error: String(err) };
    }
  }

  // ── 2. Nominatim geocoding ────────────────────────────────────────────────
  const nominatimAttempts = [
    `${suburb}, ${city}, Australia`,
    `${suburb}, ${state}, Australia`,
    `${suburb}, Australia`,
  ];
  const nominatimResults: Record<string, unknown> = {};

  for (const q of nominatimAttempts) {
    const params = new URLSearchParams({ q, format: "json", limit: "1", countrycodes: "au" });
    try {
      const res = await fetch(`https://nominatim.openstreetmap.org/search?${params}`, {
        headers: { "User-Agent": "SuburbSurfer/1.0" },
        signal: AbortSignal.timeout(5000),
      });
      const data = await res.json();
      nominatimResults[q] = {
        status: res.status,
        resultCount: data.length,
        first: data[0]
          ? { displayName: data[0].display_name, bbox: data[0].boundingbox, type: data[0].type }
          : null,
      };
    } catch (err) {
      nominatimResults[q] = { error: String(err) };
    }
  }

  // ── 3. Overpass (using first successful Nominatim bbox) ───────────────────
  let overpassResult: unknown = "skipped — no Nominatim result";

  const firstBbox = Object.values(nominatimResults).find(
    (r) => (r as Record<string, unknown>)?.first !== null &&
            (r as Record<string, unknown>)?.first !== undefined
  ) as Record<string, unknown> | undefined;

  if (firstBbox?.first) {
    const bbox = (firstBbox.first as Record<string, unknown>).bbox as string[];
    const [minLat, maxLat, minLon, maxLon] = bbox.map(Number);
    const pad = 0.005;
    const bboxStr = `${minLat - pad},${minLon - pad},${maxLat + pad},${maxLon + pad}`;
    const query = `[out:json][timeout:10];(node["amenity"~"^(restaurant|cafe|bar|fast_food)$"](${bboxStr});way["amenity"~"^(restaurant|cafe|bar|fast_food)$"](${bboxStr}););out body 15;`;

    try {
      const res = await fetch("https://overpass-api.de/api/interpreter", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: `data=${encodeURIComponent(query)}`,
        signal: AbortSignal.timeout(8000),
      });
      const data = await res.json();
      const elements = (data.elements ?? []) as Record<string, unknown>[];
      overpassResult = {
        status: res.status,
        totalElements: elements.length,
        namedVenues: elements.filter((e) => e.tags && (e.tags as Record<string,string>).name).length,
        sample: elements
          .filter((e) => e.tags && (e.tags as Record<string,string>).name)
          .slice(0, 5)
          .map((e) => ({ name: (e.tags as Record<string,string>).name, amenity: (e.tags as Record<string,string>).amenity })),
      };
    } catch (err) {
      overpassResult = { error: String(err) };
    }
  }

  return NextResponse.json({ suburb, city, state, wikipedia: wikiResults, nominatim: nominatimResults, overpass: overpassResult }, { status: 200 });
}
