import { NextRequest, NextResponse } from "next/server";
import { parseGeminiJson } from "../_lib/parseJson";
import { handleApiError } from "../_lib/apiError";
import { createClient, generate } from "../_lib/groqClient";
import { validateCity, sanitiseSuburb, sanitiseExclude } from "../_lib/validateParams";
import { checkRateLimit } from "../_lib/rateLimiter";

interface Restaurant {
  name: string;
  description: string;
}

interface FoodData {
  cuisine_types: string[];
  restaurant_recommendations: Restaurant[];
}

const ANTI_HALLUCINATION = `Critical accuracy rules you must follow:
- Only recommend restaurants and cafés you are highly confident are real, currently operating establishments.
- Do not invent venue names, addresses, or details.
- If you are not certain a venue is still open, add "(verify before visiting)" to its description.
- Prefer well-established venues with a strong, long-standing reputation over obscure or newly opened spots you are less certain about.
- If a suburb has very few dining options, recommend the closest well-known alternatives and note their actual suburb location in the description.`;

function buildPrompt(suburb: string, city: string, count: number, exclude: string[]): string {
  const excludeClause =
    exclude.length > 0
      ? `\n\nDo NOT include any of these already-listed venues: ${exclude.map((n) => `"${n}"`).join(", ")}. Return ${count} different venues.`
      : "";

  return `You are a well-informed food critic and local dining guide for ${city}, Australia, with verified knowledge of the dining scene across every suburb.

Give me ${count} restaurant or café recommendations for the suburb of ${suburb}, ${city}.${excludeClause}

${ANTI_HALLUCINATION}

Return ONLY a raw JSON object — no markdown, no code blocks, no backticks, no extra text. Start your response with { and end with }.

The JSON must have exactly these two keys:
- "cuisine_types": an array of exactly three strings, each a cuisine type or food style that is genuinely prominent in ${suburb}
- "restaurant_recommendations": an array of exactly ${count} objects, each with:
  - "name": the real venue name as a string
  - "description": a one-sentence description of what they are known for and why locals recommend them`;
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const rateLimitResult = await checkRateLimit(request);
  if (rateLimitResult.limited) return rateLimitResult.response;

  const rawSuburb = request.nextUrl.searchParams.get("suburb");
  const rawCity = request.nextUrl.searchParams.get("city");
  const countParam = request.nextUrl.searchParams.get("count");
  const excludeParam = request.nextUrl.searchParams.get("exclude");

  const city = validateCity(rawCity);
  if (!city) {
    return NextResponse.json({ error: "Invalid city." }, { status: 400 });
  }

  const suburb = sanitiseSuburb(rawSuburb);
  if (!suburb) {
    return NextResponse.json({ error: "Missing or invalid suburb name." }, { status: 400 });
  }

  const count = Math.min(Math.max(parseInt(countParam ?? "3", 10) || 3, 1), 5);
  const exclude = sanitiseExclude(excludeParam);
  const apiKey = process.env.GROQ_API_KEY;

  if (!apiKey) {
    return NextResponse.json({ error: "GROQ_API_KEY is not configured." }, { status: 500 });
  }

  try {
    const client = createClient(apiKey);
    const text = await generate(client, buildPrompt(suburb, city, count, exclude));
    const parsed = parseGeminiJson<FoodData>(text);
    return NextResponse.json(parsed);
  } catch (err) {
    return handleApiError("food", err);
  }
}
