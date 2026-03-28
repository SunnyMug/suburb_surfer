import { NextRequest, NextResponse } from "next/server";
import { parseGeminiJson } from "../_lib/parseJson";
import { handleApiError } from "../_lib/apiError";
import { createClient, generate } from "../_lib/groqClient";
import { validateCity, sanitiseSuburb } from "../_lib/validateParams";
import { checkRateLimit } from "../_lib/rateLimiter";
import { fetchSuburbWikiContext } from "../_lib/wikipedia";
import { fetchSuburbVenues, buildVenueContext } from "../_lib/foursquare";

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

// Area zones per city used to steer the random pick away from well-known defaults.
const CITY_ZONES: Record<string, string[]> = {
  Sydney: [
    "the inner west (e.g. Leichardt, Ashfield, Dulwich Hill, Marrickville, Stanmore, Petersham, Tempe)",
    "the lower north shore (e.g. Neutral Bay, Cremorne, Kirribilli, Waverton, Wollstonecraft)",
    "the upper north shore (e.g. Killara, Lindfield, Turramurra, Wahroonga, Pymble)",
    "the northern beaches (e.g. Dee Why, Collaroy, Narrabeen, Avalon, Palm Beach, Mona Vale)",
    "the eastern suburbs (e.g. Randwick, Coogee, Bronte, Maroubra, Kingsford, Kensington)",
    "the inner east (e.g. Paddington, Surry Hills, Redfern, Waterloo, Alexandria, Zetland)",
    "the Hills District (e.g. Baulkham Hills, Kellyville, Castle Hill, Rouse Hill, Cherrybrook)",
    "the south-western suburbs (e.g. Liverpool, Fairfield, Cabramatta, Bankstown, Lakemba)",
    "the Sutherland Shire (e.g. Cronulla, Miranda, Caringbah, Gymea, Engadine, Menai)",
    "the St George area (e.g. Kogarah, Hurstville, Rockdale, Blakehurst, Carlton)",
    "the western suburbs (e.g. Merrylands, Granville, Auburn, Lidcombe, Wentworthville)",
    "the Blue Mountains foothills (e.g. Penrith, Emu Plains, Glenbrook, Springwood)",
    "the Hawkesbury and north-west (e.g. Windsor, Richmond, Riverstone, Box Hill, Schofields)",
    "the Macarthur region (e.g. Campbelltown, Camden, Narellan, Picton, Oran Park)",
  ],
  Melbourne: [
    "the inner north (e.g. Fitzroy, Collingwood, Northcote, Brunswick, Preston)",
    "the inner south (e.g. South Yarra, Prahran, Windsor, St Kilda, Elwood)",
    "the inner west (e.g. Footscray, Yarraville, Seddon, Williamstown, Newport)",
    "the eastern suburbs (e.g. Box Hill, Doncaster, Ringwood, Croydon, Mitcham)",
    "the south-eastern suburbs (e.g. Dandenong, Springvale, Noble Park, Moorabbin, Cheltenham)",
    "the Mornington Peninsula fringe (e.g. Frankston, Langwarrin, Seaford, Carrum)",
    "the Bayside suburbs (e.g. Brighton, Sandringham, Mentone, Beaumaris, Black Rock)",
    "the northern suburbs (e.g. Coburg, Reservoir, Thomastown, Epping, South Morang)",
    "the western growth corridor (e.g. Werribee, Hoppers Crossing, Wyndham Vale, Point Cook)",
    "the Dandenong Ranges fringe (e.g. Belgrave, Ferntree Gully, Boronia, Knox)",
  ],
  Brisbane: [
    "the inner south (e.g. South Brisbane, Woolloongabba, Annerley, Greenslopes)",
    "the inner north (e.g. Fortitude Valley, Newstead, Teneriffe, New Farm, Windsor)",
    "the western suburbs (e.g. Toowong, Auchenflower, Indooroopilly, Fig Tree Pocket)",
    "the south-eastern suburbs (e.g. Mount Gravatt, Carindale, Wishart, Mansfield)",
    "the northern suburbs (e.g. Chermside, Aspley, Stafford, Everton Park, Kedron)",
    "the Redlands and bayside (e.g. Cleveland, Capalaba, Victoria Point, Redland Bay)",
    "the south-western suburbs (e.g. Inala, Richlands, Forest Lake, Darra, Oxley)",
  ],
  Perth: [
    "the inner northern suburbs (e.g. Leederville, Mount Lawley, Inglewood, Maylands)",
    "the northern coastal suburbs (e.g. Scarborough, Trigg, Carine, Duncraig, Hillarys)",
    "the southern suburbs (e.g. Fremantle, Hamilton Hill, Spearwood, Bibra Lake, Cockburn)",
    "the eastern suburbs (e.g. Midland, Guildford, Swan View, Kalamunda, Mundaring)",
    "the south-eastern suburbs (e.g. Cannington, Gosnells, Maddington, Thornlie)",
    "the inner south (e.g. Victoria Park, Carlisle, St James, Bentley, Wilson)",
    "the south-western corridor (e.g. Mandurah fringe: Rockingham, Baldivis, Safety Bay)",
  ],
  Adelaide: [
    "the inner east (e.g. Norwood, Kensington, Magill, Burnside, Beaumont)",
    "the inner west (e.g. Bowden, Brompton, Hindmarsh, West Croydon, Woodville)",
    "the inner south (e.g. Unley, Malvern, Goodwood, Clarence Park, Millswood)",
    "the northern suburbs (e.g. Prospect, Enfield, Blair Athol, Gepps Cross, Elizabeth)",
    "the southern suburbs (e.g. Marion, Morphett Vale, Noarlunga, Christie Downs)",
    "the Adelaide Hills fringe (e.g. Stirling, Aldgate, Bridgewater, Crafers, Belair)",
    "the western coastal suburbs (e.g. Glenelg, Brighton, Hove, Somerton Park, Henley Beach)",
  ],
  Canberra: [
    "Belconnen (e.g. Bruce, Belconnen town centre, Macquarie, Hawker, Evatt)",
    "Gungahlin (e.g. Gungahlin town centre, Franklin, Harrison, Ngunnawal, Amaroo)",
    "North Canberra (e.g. Ainslie, Braddon, Downer, Watson, Hackett, Dickson)",
    "South Canberra (e.g. Griffith, Narrabundah, Forrest, Barton, Kingston, Manuka)",
    "Tuggeranong (e.g. Greenway, Kambah, Wanniassa, Calwell, Fadden, Weston Creek)",
    "Woden and Weston Creek (e.g. Phillip, Garran, Hughes, Lyons, Holder, Chapman)",
  ],
  Hobart: [
    "the inner city and waterfront (e.g. Battery Point, Sandy Bay, South Hobart, West Hobart)",
    "the eastern shore (e.g. Bellerive, Rosny, Clarence, Howrah, Rokeby, Lindisfarne)",
    "the northern suburbs (e.g. Moonah, Glenorchy, Lutana, Claremont, Berriedale)",
    "the southern and channel suburbs (e.g. Kingston, Blackmans Bay, Taroona, Margate)",
  ],
  Darwin: [
    "the inner suburbs (e.g. Larrakeyah, Stuart Park, Parap, Fannie Bay, The Gardens)",
    "the northern suburbs (e.g. Nightcliff, Rapid Creek, Coconut Grove, Alawa, Nakara)",
    "the southern suburbs (e.g. Winnellie, Berrimah, Yarrawonga, Marrara, Wulagi)",
    "the Palmerston area (e.g. Palmerston city, Moulden, Woodroffe, Gunn, Rosebery)",
  ],
};

const ALPHABET = "ABCDEFGHIJKLMNOPRSTW";

function pickRandom<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function buildPrompt(
  city: string,
  suburb?: string,
  wikiContext?: string | null,
  venueContext?: string
): string {
  if (suburb) {
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

${wikiBlock}${venueContext ?? ""}${ANTI_HALLUCINATION}

${JSON_RULES}`;
  }

  const zones = CITY_ZONES[city] ?? CITY_ZONES["Sydney"];
  const zone = pickRandom(zones);
  const letter = pickRandom(ALPHABET.split(""));
  const seed = Math.floor(Math.random() * 9000) + 1000;

  return `You are a knowledgeable local guide and historian for ${city}, Australia, with deep familiarity with every suburb in the greater ${city} region.

Random seed: ${seed}. Use this to ensure variety across calls.

Your task: pick ONE real, specific suburb from ${city} and describe it. To ensure variety, focus your selection on ${zone}. Prefer suburbs whose name starts with the letter "${letter}" if a good match exists in that area, otherwise pick any suburb from that zone.

Do NOT default to the most famous or commonly mentioned suburbs. Avoid well-known defaults like Newtown, Surry Hills, Parramatta, Petersham, Fitzroy, or St Kilda unless they are genuinely the best fit for the zone and letter hint. Aim for suburbs that are interesting but less frequently spotlighted.

${ANTI_HALLUCINATION}

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

    // Fetch Wikipedia + Foursquare in parallel for explicit searches.
    // Skipped for random picks — suburb name isn't known until the LLM responds.
    const [wikiContext, venues] = suburb
      ? await Promise.all([
          fetchSuburbWikiContext(suburb, city),
          fetchSuburbVenues(suburb, city),
        ])
      : [null, []];

    const venueContext = buildVenueContext(venues, suburb ?? "", city);
    const text = await generate(
      client,
      buildPrompt(city, suburb ?? undefined, wikiContext, venueContext)
    );
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
