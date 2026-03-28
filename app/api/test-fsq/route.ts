import { NextRequest, NextResponse } from "next/server";
import { fetchSuburbVenues } from "../_lib/foursquare";

/**
 * Quick diagnostic endpoint — remove before going to production.
 * Usage: GET /api/test-fsq?suburb=Strathfield&city=Sydney
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const suburb = request.nextUrl.searchParams.get("suburb") ?? "Strathfield";
  const city = request.nextUrl.searchParams.get("city") ?? "Sydney";

  const venues = await fetchSuburbVenues(suburb, city);

  return NextResponse.json({ suburb, city, count: venues.length, venues });
}
