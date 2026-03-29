import { NextRequest, NextResponse } from "next/server";
import { parseGeminiJson } from "../_lib/parseJson";
import { handleApiError } from "../_lib/apiError";
import { createClient, generate } from "../_lib/groqClient";
import { validateCity, sanitiseSuburb } from "../_lib/validateParams";
import { checkRateLimit } from "../_lib/rateLimiter";
import { fetchSuburbWikiContext } from "../_lib/wikipedia";
import { fetchSuburbVenues, buildVenueContext } from "../_lib/foursquare";
import { pickRandomSuburb } from "../_lib/suburbList";

interface SuburbData {
  name: string;
  summary: string;
  fun_facts: string[];
  local_attractions: string[];
  name_etymology: string;
  cuisine_types: string[];
  restaurant_recommendations: { name: string; description: string }[];
  key_events: { year: string; event: string }[];
  notable_people: { name: string; role: string }[];
  heritage_sites: string[];
}

// Extends SuburbData with a validation-only field stripped before returning to the client.
interface RawSuburbResponse extends SuburbData {
  is_suburb: boolean;
}

const ANTI_HALLUCINATION = `Critical accuracy rules you must follow:
- SUBURB DEFINITION: A suburb is a gazetted residential or mixed-use area with its own official name in the state/territory's address database. Train stations, railway stops, nature reserves, national parks, state forests, hospitals, universities, airports, industrial precincts, and landmarks are NOT suburbs — even if they share a name with a location. If you are not certain a place is a real gazetted suburb, set is_suburb to false.
- Only state facts you are highly confident are accurate and widely verifiable.
- For fun_facts and name_etymology: if the true origin or fact is disputed or uncertain, explicitly acknowledge that uncertainty (e.g. "believed to be…" or "likely derived from…").
- For local_attractions: only include real, well-known places you are confident exist in that suburb.
- For restaurant_recommendations: if a VERIFIED DINING DIRECTORY is provided above, you MUST only use venues from that list — no additions, no substitutions. If no directory is provided, only recommend establishments you are highly confident are real and currently operating. Never invent venue names.
- For cuisine_types: only list food styles that are genuinely prominent in that suburb's dining scene.
- For key_events: only include dates you are highly confident are accurate. If approximate, prefix with "c." (e.g. "c. 1892").
- For notable_people: only include individuals with a well-documented, specific connection to this suburb — not just the broader city.
- For heritage_sites: only include sites that are genuinely heritage-listed or widely recognised for historical significance.
- Do not fabricate or embellish any detail. Accuracy is more important than sounding interesting.`;

const JSON_RULES = `Return ONLY a raw JSON object — no markdown, no code blocks, no backticks, no extra text, no commentary. Start your response with { and end with }.

The JSON must have exactly these eleven keys:
- "name": the canonical suburb name as a string
- "is_suburb": a boolean — true only if this is a genuine gazetted residential or mixed-use suburb; false if it is a train station, nature reserve, park, hospital, university, industrial area, or any other non-suburb location
- "summary": a two-sentence vibe check written in a fun, punchy tone
- "fun_facts": an array of exactly two short, verifiable fun fact strings
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
- "heritage_sites": an array of exactly two strings, each naming a real heritage-listed or historically significant site in or very near this suburb`;



function buildPrompt(
  city: string,
  suburb: string,
  wikiContext: string | null,
  venueContext: string
): string {
  const wikiBlock = wikiContext
    ? `VERIFIED REFERENCE MATERIAL (from Wikipedia — use as your primary source for all factual claims):
---
${wikiContext}
---
Base your historical facts, etymology, key events, notable people, and heritage sites on the above. You may supplement gaps with your own knowledge, but do not contradict the reference material.

`
    : "";

  return `You are a knowledgeable local guide and historian for ${city}, Australia, with deep familiarity with every suburb in the greater ${city} region.

Describe the ${city} suburb "${suburb}", covering its character, dining scene, and local history.

If the name is slightly misspelt, use the correct canonical spelling in the "name" field. If this is genuinely not a suburb of ${city}, set "name" to the closest real ${city} suburb and note the correction in the summary.

${wikiBlock}${venueContext}${ANTI_HALLUCINATION}

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

  const apiKey = process.env.GROQ_API_KEY;
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

    // Fetch Wikipedia + OSM in parallel — now always runs, for both paths.
    const [wikiContext, venues] = await Promise.all([
      fetchSuburbWikiContext(resolvedSuburb, city),
      fetchSuburbVenues(resolvedSuburb, city),
    ]);

    const venueContext = buildVenueContext(venues, resolvedSuburb, city);
    const text = await generate(client, buildPrompt(city, resolvedSuburb, wikiContext, venueContext));
    const { is_suburb, ...parsed } = parseGeminiJson<RawSuburbResponse>(text);

    if (is_suburb === false) {
      console.warn(`[explore] model returned non-suburb: "${parsed.name}" for city ${city}`);
      return NextResponse.json(
        { error: `"${parsed.name}" isn't a real ${city} suburb — it might be a train station, park, or landmark. Hit the button again for another pick.` },
        { status: 422 }
      );
    }

    return NextResponse.json(parsed);
  } catch (err) {
    return handleApiError("explore", err);
  }
}
