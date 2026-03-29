/**
 * Uses the Wikipedia REST summary API rather than the action API.
 * The REST endpoint handles redirects automatically, returns a clean 404
 * for missing pages, and surfaces disambiguation pages via `type` — all of
 * which the action=query&titles= approach handled unreliably.
 */

const WIKI_REST = "https://en.wikipedia.org/api/rest_v1/page/summary";
const TIMEOUT_MS = 5_000;
const MAX_CHARS = 3_000;

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

interface WikiSummary {
  type?: string;   // "standard" | "disambiguation" | "no-extract"
  extract?: string;
}

async function fetchExtract(title: string): Promise<string | null> {
  // REST API uses underscores and encodes the comma: "Castle_Hill,_New_South_Wales"
  const slug = encodeURIComponent(title.replace(/ /g, "_"));

  try {
    const res = await fetch(`${WIKI_REST}/${slug}`, {
      headers: {
        "User-Agent": "SuburbSurfer/1.0",
        "Accept": "application/json",
      },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    if (!res.ok) return null;

    const data: WikiSummary = await res.json();

    // Disambiguation and no-extract pages have no usable content.
    if (data.type === "disambiguation" || data.type === "no-extract") return null;
    if (!data.extract?.trim()) return null;

    return data.extract.slice(0, MAX_CHARS).trim();
  } catch {
    return null;
  }
}

/**
 * Fetches the Wikipedia introductory section for a suburb.
 * Tries "{suburb}, {state}" first (most specific), then "{suburb}" alone.
 *
 * Returns null silently on any error or timeout — callers treat this as
 * optional context and proceed without it.
 */
export async function fetchSuburbWikiContext(
  suburb: string,
  city: string
): Promise<string | null> {
  const state = CITY_TO_STATE[city];
  const attempts = state ? [`${suburb}, ${state}`, suburb] : [suburb];

  for (const title of attempts) {
    const extract = await fetchExtract(title);
    if (extract) {
      console.log(`[wikipedia] fetched "${title}" (${extract.length} chars)`);
      return extract;
    }
  }

  console.warn(`[wikipedia] no article found for "${suburb}" in ${city}`);
  return null;
}
