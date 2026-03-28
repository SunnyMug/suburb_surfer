import { NextRequest, NextResponse } from "next/server";
import { parseGeminiJson } from "../_lib/parseJson";
import { handleApiError } from "../_lib/apiError";
import { createClient, generate } from "../_lib/groqClient";

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

const ANTI_HALLUCINATION = `Critical accuracy rules you must follow:
- Only state facts you are highly confident are accurate and widely verifiable.
- For fun_facts and name_etymology: if the true origin or fact is disputed or uncertain, explicitly acknowledge that uncertainty (e.g. "believed to be…" or "likely derived from…").
- For local_attractions: only include real, well-known places you are confident exist in that suburb.
- For restaurant_recommendations: only recommend real, currently operating establishments you are highly confident about. If uncertain about a venue's current status, add "(verify before visiting)" to its description. Prefer well-established venues with a long-standing reputation.
- For cuisine_types: only list food styles that are genuinely prominent in that suburb's dining scene.
- For key_events: only include dates you are highly confident are accurate. If approximate, prefix with "c." (e.g. "c. 1892").
- For notable_people: only include individuals with a well-documented, specific connection to this suburb — not just the broader city.
- For heritage_sites: only include sites that are genuinely heritage-listed or widely recognised for historical significance.
- Do not fabricate or embellish any detail. Accuracy is more important than sounding interesting.`;

const JSON_RULES = `Return ONLY a raw JSON object — no markdown, no code blocks, no backticks, no extra text, no commentary. Start your response with { and end with }.

The JSON must have exactly these ten keys:
- "name": the canonical suburb name as a string
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

function buildPrompt(city: string, suburb?: string): string {
  if (suburb) {
    return `You are a knowledgeable local guide and historian for ${city}, Australia, with deep familiarity with every suburb in the greater ${city} region.

Describe the ${city} suburb "${suburb}", covering its character, dining scene, and local history.

If the name is slightly misspelt, use the correct canonical spelling in the "name" field. If this is genuinely not a suburb of ${city}, set "name" to the closest real ${city} suburb and note the correction in the summary.

${ANTI_HALLUCINATION}

${JSON_RULES}`;
  }

  return `You are a knowledgeable local guide and historian for ${city}, Australia, with deep familiarity with every suburb in the greater ${city} region.

Pick a completely random, unique suburb from the greater ${city} region — vary widely across inner-city, waterfront, western, northern, and southern suburbs. Describe its character, dining scene, and local history.

${ANTI_HALLUCINATION}

${JSON_RULES}`;
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const suburb = request.nextUrl.searchParams.get("suburb") ?? undefined;
  const city = request.nextUrl.searchParams.get("city") ?? "Sydney";
  const apiKey = process.env.GROQ_API_KEY;

  if (!apiKey) {
    return NextResponse.json({ error: "GROQ_API_KEY is not configured." }, { status: 500 });
  }

  try {
    const client = createClient(apiKey);
    const text = await generate(client, buildPrompt(city, suburb));
    const parsed = parseGeminiJson<SuburbData>(text);
    return NextResponse.json(parsed);
  } catch (err) {
    return handleApiError("explore", err);
  }
}
