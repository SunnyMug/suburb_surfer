const WIKI_API = "https://en.wikipedia.org/w/api.php";
const TIMEOUT_MS = 4_000;
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

interface WikiPage {
  missing?: boolean;
  extract?: string;
}

async function fetchExtract(title: string): Promise<string | null> {
  const params = new URLSearchParams({
    action: "query",
    prop: "extracts",
    exintro: "true",
    explaintext: "true",
    titles: title,
    format: "json",
    redirects: "1",
  });

  try {
    const res = await fetch(`${WIKI_API}?${params}`, {
      headers: { "User-Agent": "SuburbSurfer/1.0" },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    if (!res.ok) return null;

    const data = await res.json();
    const pages: Record<string, WikiPage> = data?.query?.pages;
    if (!pages) return null;

    const page = Object.values(pages)[0];
    if (page?.missing || !page?.extract?.trim()) return null;

    return page.extract.slice(0, MAX_CHARS).trim();
  } catch {
    return null;
  }
}

/**
 * Fetches the Wikipedia introductory section for a suburb.
 * Tries "{suburb}, {state}" first (most specific), then falls back to
 * just "{suburb}" if nothing is found.
 *
 * Returns null silently on any error or timeout — callers should treat
 * this as optional context and proceed without it if null.
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
      console.log(`[wikipedia] fetched context for "${title}" (${extract.length} chars)`);
      return extract;
    }
  }

  console.warn(`[wikipedia] no article found for "${suburb}" in ${city}`);
  return null;
}
