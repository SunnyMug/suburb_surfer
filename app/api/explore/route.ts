import { NextRequest, NextResponse } from "next/server";
import { parseGeminiJson } from "../_lib/parseJson";
import { handleApiError } from "../_lib/apiError";
import { createClient, generate } from "../_lib/groqClient";
import { validateCity, sanitiseSuburb } from "../_lib/validateParams";
import { checkRateLimit } from "../_lib/rateLimiter";
import { fetchSuburbWikiContext, WikiContext } from "../_lib/wikipedia";
import { fetchSuburbVenues, buildVenueContext } from "../_lib/foursquare";
import { pickRandomSuburb } from "../_lib/suburbList";
import { getCachedSuburbFromSupabase, saveCachedSuburbToSupabase } from "../../../lib/supabase";

interface SuburbData {
  name: string;
  summary: string;
  fun_facts: string[];
  local_attractions: string[];
  name_etymology: string;
  cuisine_types: string[];
  restaurant_recommendations: { name: string; description: string; lat?: number; lng?: number }[];
  key_events: { year: string; event: string }[];
  notable_people: { name: string; role: string }[];
  heritage_sites: string[];
  demographics?: {
    data_year: string;
    data_source: string;
    population: string;
    top_ancestries: { name: string; percentage: number }[];
    top_languages: { name: string; percentage: number }[];
  } | null;
  image_url?: string;
  rawVenues?: any[];
}

// Extends SuburbData with a validation-only field stripped before returning to the client.
interface RawSuburbResponse extends SuburbData {
  is_suburb: boolean;
}

const ANTI_HALLUCINATION = `Critical accuracy rules you must follow:
- SUBURB DEFINITION: A suburb is a gazetted residential or mixed-use area with its own official name in the state/territory's address database. Train stations, railway stops, nature reserves, national parks, state forests, hospitals, universities, airports, industrial precincts, and landmarks are NOT suburbs — even if they share a name with a location. If you are not certain a place is a real gazetted suburb, set is_suburb to false.
- Only state facts you are highly confident are accurate and widely verifiable.
- For name_etymology: derive the explanation STRICTLY from the NAME/ETYMOLOGY SOURCE block if one is provided. If that block is absent or does not mention the name's origin, also check the HISTORY SOURCE block — suburb name origins are frequently described inline within the history section rather than in a dedicated section. If neither source block mentions the origin, use your own knowledge but explicitly acknowledge uncertainty (e.g. "believed to be…" or "likely derived from…"). Never invent an etymology. Do NOT mention or reference any external source by name in your output.
- For key_events: use ONLY events found in the HISTORY SOURCE block if one is provided. Dates must match what the source states; use "c." prefix if the source says approximately. Do not add events from your own knowledge unless no history block is provided.
- For notable_people: use ONLY individuals named in the NOTABLE RESIDENTS SOURCE block if one is provided. Do not add people from your own knowledge unless no residents block is provided.
- For heritage_sites: use ONLY sites named in the HERITAGE SITES SOURCE block if one is provided. Do not add sites from your own knowledge unless no heritage block is provided.
- For fun_facts: if the source blocks above contain interesting verifiable details not covered by the other fields, prefer those. If uncertain, acknowledge it (e.g. "believed to be…"). CRITICAL: Fun facts MUST NOT overlap with name_etymology. Do not include trivia about the suburb's name or its origin here; keep name origins exclusively in name_etymology.
- For local_attractions: only include real, well-known places you are confident exist in that suburb.
- For restaurant_recommendations: if a VERIFIED DINING DIRECTORY is provided above, you MUST only use venues from that list — no additions, no substitutions. If no directory is provided, only recommend establishments you are highly confident are real and currently operating. Never invent venue names.
- For cuisine_types: only list food styles that are genuinely prominent in that suburb's dining scene.
- Do not fabricate or embellish any detail. Accuracy is more important than sounding interesting.`;

const JSON_RULES = `Return ONLY a raw JSON object — no markdown, no code blocks, no backticks, no extra text, no commentary. Start your response with { and end with }.

The JSON must have exactly these twelve keys:
- "name": the canonical suburb name as a string
- "is_suburb": a boolean — true only if this is a genuine gazetted residential or mixed-use suburb; false if it is a train station, nature reserve, park, hospital, university, industrial area, or any other non-suburb location
- "summary": two honest, specific sentences about what this suburb is actually like. Write like a knowledgeable local, not a real estate agent. Be direct — if it's quiet and residential, say so; if it's known for a specific community, cuisine strip, or industry, lead with that. FORBIDDEN words and phrases: "hidden gem", "tucked away", "vibrant", "eclectic", "bustling", "thriving", "nestled", "charming", "lively", "unique blend", "hub of", "little-known", "off the beaten track", "something for everyone"
- "fun_facts": an array of exactly two short, verifiable fun fact strings. These MUST NOT contain any information about the etymology, naming, or meaning of the suburb's name.
- "local_attractions": an array of exactly two real, well-known local attraction strings
- "name_etymology": a two-sentence explanation of the verified origin and meaning of the suburb's name, noting Aboriginal, colonial, or historical context where known
- "cuisine_types": an array of exactly three cuisine types or food styles that are genuinely prominent in this suburb
- "restaurant_recommendations": an array of exactly three objects, each with:
  - "name": the real venue name as a string
  - "description": a one-sentence description of what they are known for and why locals recommend them
- "key_events": an array of exactly three objects, each with:
  - "year": a string for the year or period (e.g. "1882", "c. 1910", "1940s")
  - "event": a one-sentence description of the historical event
- "notable_people": an array of exactly two objects, each with:
  - "name": the person's full name as a string
  - "role": a one-sentence description of their specific connection to this suburb
- "heritage_sites": an array of exactly two strings, each naming a real heritage-listed or historically significant site in or very near this suburb
- "demographics": an object containing the following keys (or null if the DEMOGRAPHICS SOURCE is missing or contains no data):
  - "data_year": the year the data was collected as a string (e.g. "2021", or "Unknown")
  - "data_source": the source of the data as a string (e.g. "Australian Bureau of Statistics", or "Census Data" if not explicitly named)
  - "population": the total population as a string (e.g. "5,234")
  - "top_ancestries": an array of up to ten objects, each with "name" (e.g. "English") and "percentage" as a strictly numeric value (e.g. 25.2). Return empty array if not mentioned. Extract as many as are explicitly listed with percentages, up to a maximum of 10.
  - "top_languages": an array of up to ten objects, each with "name" (e.g. "Mandarin") and "percentage" as a strictly numeric value (e.g. 15.0). Return empty array if not mentioned. Extract as many as are explicitly listed with percentages, up to a maximum of 10.`;



/**
 * Coerces a value that should be a string to an actual string.
 * Fallback LLMs sometimes return structured objects for string fields;
 * joining the object's values produces readable text rather than crashing.
 */
function coerceToString(value: unknown): string {
  if (typeof value === "string") return value;
  if (value === null || value === undefined) return "";
  if (typeof value === "object") {
    return Object.values(value as Record<string, unknown>)
      .filter((v) => typeof v === "string")
      .join(" ");
  }
  return String(value);
}

function buildWikiBlocks(ctx: WikiContext | null): string {
  if (!ctx) return "";

  const blocks: string[] = [];

  // Name/etymology: prefer the dedicated section; fall back to intro which
  // usually contains the origin sentence for suburbs that lack their own section.
  const etymologyText = ctx.nameEtymology ?? ctx.intro;
  if (etymologyText) {
    blocks.push(
      `NAME/ETYMOLOGY SOURCE (use this as the primary source for the name_etymology field):\n---\n${etymologyText}\n---`
    );
  }

  if (ctx.history) {
    blocks.push(
      `HISTORY SOURCE (use this as the primary source for the key_events field):\n---\n${ctx.history}\n---`
    );
  }

  if (ctx.heritage) {
    blocks.push(
      `HERITAGE SITES SOURCE (use this as the primary source for the heritage_sites field):\n---\n${ctx.heritage}\n---`
    );
  }

  if (ctx.notableResidents) {
    blocks.push(
      `NOTABLE RESIDENTS SOURCE (use this as the primary source for the notable_people field):\n---\n${ctx.notableResidents}\n---`
    );
  }

  if (ctx.demographics) {
    blocks.push(
      `DEMOGRAPHICS SOURCE (use this as the primary source for the demographics field. Do not make up statistics!):\n---\n${ctx.demographics}\n---`
    );
  }

  if (blocks.length === 0) return "";

  return (
    `The following are VERIFIED REFERENCE MATERIAL sections. Each block ` +
    `is labelled with the JSON field it primarily grounds. Do NOT contradict these sources. Do NOT reference them by name in your output.\n\n` +
    blocks.join("\n\n") +
    "\n\n"
  );
}

function buildPrompt(
  city: string,
  suburb: string,
  wikiContext: WikiContext | null,
  venueContext: string
): string {
  const wikiBlocks = buildWikiBlocks(wikiContext);

  return `You are a knowledgeable local guide and historian for ${city}, Australia, with deep familiarity with every suburb in the greater ${city} region.

Describe the ${city} suburb "${suburb}", covering its character, dining scene, and local history.

If the name is slightly misspelt, use the correct canonical spelling in the "name" field. If this is genuinely not a suburb of ${city}, set "name" to the closest real ${city} suburb and note the correction in the summary.

${wikiBlocks}${venueContext}${ANTI_HALLUCINATION}

${JSON_RULES}`;
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const rateLimitResult = await checkRateLimit(request);
  if (rateLimitResult.limited) return rateLimitResult.response;

  const rawCity = request.nextUrl.searchParams.get("city");
  const rawSuburb = request.nextUrl.searchParams.get("suburb");

  const city = validateCity(rawCity);
  if (!city) {
    return NextResponse.json({ error: "Invalid city." }, { status: 400 });
  }

  const suburb = rawSuburb !== null ? sanitiseSuburb(rawSuburb) : undefined;
  if (rawSuburb !== null && !suburb) {
    return NextResponse.json({ error: "Invalid suburb name." }, { status: 400 });
  }

  const apiKey = process.env.GROQ_API_KEY || process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "GROQ_API_KEY is not configured." }, { status: 500 });
  }

  try {
    const client = createClient(apiKey);

    // For random mode: pick from the verified suburb list — no LLM hallucinations.
    let resolvedSuburb = suburb;
    if (!resolvedSuburb) {
      const picked = pickRandomSuburb(city);
      if (!picked) {
        return NextResponse.json(
          { error: "No suburb list available for this city." },
          { status: 500 }
        );
      }
      resolvedSuburb = picked;
      console.log(`[explore] random pick: "${resolvedSuburb}" for ${city}`);
    }

    const currentSuburb: string = resolvedSuburb;

    // Check Supabase global shared cache first (instant 50ms response)
    const cachedData = await getCachedSuburbFromSupabase(city, currentSuburb);
    if (cachedData) {
      return NextResponse.json(cachedData);
    }

    // Fetch Wikipedia + OSM in parallel — now always runs, for both paths.
    const [wikiContext, venues] = await Promise.all([
      fetchSuburbWikiContext(currentSuburb, city),
      fetchSuburbVenues(currentSuburb, city),
    ]);

    const venuesAvailable = venues.length > 0;
    const venueContext = buildVenueContext(venues, currentSuburb, city);
    const text = await generate(client, buildPrompt(city, currentSuburb, wikiContext, venueContext));
    const { is_suburb, ...parsed } = parseGeminiJson<RawSuburbResponse>(text);

    // Smaller fallback models sometimes return string fields as objects
    // (e.g. name_etymology: { etymology: "...", context: "..." }).
    // Flatten any such fields to a plain string before sending to the client.
    parsed.name_etymology   = coerceToString(parsed.name_etymology);
    parsed.summary          = coerceToString(parsed.summary);
    parsed.name             = coerceToString(parsed.name);

    if (is_suburb === false) {
      console.warn(`[explore] model returned non-suburb: "${parsed.name}" for city ${city}`);
      return NextResponse.json(
        { error: `"${parsed.name}" isn't a real ${city} suburb — it might be a train station, park, or landmark. Hit the button again for another pick.` },
        { status: 422 }
      );
    }

    // When OSM returned no venues, clear any restaurant recommendations the LLM
    // may have invented rather than serving unverified results to the client.
    if (!venuesAvailable) {
      parsed.restaurant_recommendations = [];
    }

    if (wikiContext?.imageUrl) {
      parsed.image_url = wikiContext.imageUrl;
    }

    // Enrich LLM recommendations with exact coordinates from OSM data
    if (venuesAvailable) {
      const venueMap = new Map(venues.map(v => [v.name.toLowerCase(), v]));
      parsed.restaurant_recommendations = parsed.restaurant_recommendations.map(rec => {
        const match = venueMap.get(rec.name.toLowerCase());
        return match ? { ...rec, lat: match.lat, lng: match.lng } : rec;
      });
    }

    const responsePayload = { ...parsed, venuesAvailable, rawVenues: venues };

    // Asynchronously save to Supabase cache for all future users worldwide
    saveCachedSuburbToSupabase(city, parsed.name, responsePayload).catch((err) =>
      console.warn("[supabase] background cache write failed:", err)
    );

    return NextResponse.json(responsePayload);
  } catch (err) {
    return handleApiError("explore", err);
  }
}
