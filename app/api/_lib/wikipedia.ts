/**
 * Fetches targeted sections from a Wikipedia article using the action API with
 * explaintext=true (plain text, no markup). The full article text is returned
 * with == Section == markers, which we parse into a structured object so each
 * section can be threaded into the specific LLM prompt field it grounds.
 *
 * Why not the REST summary endpoint? It only returns the opening paragraph —
 * the History, Heritage, and Notable Residents sections are never fetched,
 * leaving the LLM to fill those fields from its own unreliable knowledge.
 */

const WIKI_API   = "https://en.wikipedia.org/w/api.php";
const TIMEOUT_MS = 8_000;

// Per-section and total character caps to keep the prompt a reasonable size.
const SECTION_MAX_CHARS = 1_500;
const INTRO_MAX_CHARS   = 800;
const TOTAL_MAX_CHARS   = 6_000;

const CITY_TO_STATE: Record<string, string> = {
  Sydney:    "New South Wales",
  Melbourne: "Victoria",
  Brisbane:  "Queensland",
  Perth:     "Western Australia",
  Adelaide:  "South Australia",
  Canberra:  "Australian Capital Territory",
  Hobart:    "Tasmania",
  Darwin:    "Northern Territory",
};

export interface WikiContext {
  intro:            string | null; // text before first ==
  history:          string | null; // == History == (all sub-sections included)
  heritage:         string | null; // == Heritage listings ==
  notableResidents: string | null; // == Notable residents == / == Notable people ==
  nameEtymology:    string | null; // == Name == / == Etymology == (not always present)
  demographics:     string | null; // == Demographics == / == Population ==
  imageUrl:         string | null;
}

// Headings we actively look for (matched case-insensitively on the normalised heading).
const SECTION_TARGETS: Record<keyof Omit<WikiContext, "intro" | "imageUrl">, string[]> = {
  history:          ["history"],
  heritage:         ["heritage"],
  notableResidents: ["notable residents", "notable people", "notable alumni"],
  nameEtymology:    ["name", "etymology", "origin"],
  demographics:     ["demographics", "population", "people"],
};

/**
 * Splits a full Wikipedia plain-text article into intro + named sections.
 * Section headings look like `\n== Heading ==\n` in the explaintext output.
 */
function parseArticle(fullText: string): WikiContext {
  // Split on lines that ARE a top-level heading (== text ==).
  // We keep the heading text so we can match it against targets.
  const topLevelRe = /\n(==\s+[^=\n]+\s+==)\n/g;

  const segments: { heading: string; body: string }[] = [];
  let lastIndex = 0;
  let introText = "";
  let match: RegExpExecArray | null;

  while ((match = topLevelRe.exec(fullText)) !== null) {
    const body = fullText.slice(lastIndex, match.index);
    if (lastIndex === 0) {
      introText = body;
    } else {
      segments[segments.length - 1].body = body;
    }
    segments.push({ heading: match[1], body: "" });
    lastIndex = match.index + match[0].length;
  }
  // Remaining text belongs to the last segment (or intro if no sections at all).
  if (segments.length > 0) {
    segments[segments.length - 1].body = fullText.slice(lastIndex);
  } else {
    introText = fullText;
  }

  // Normalise heading: strip == markers and whitespace, lowercase.
  function normalise(h: string): string {
    return h.replace(/=+/g, "").trim().toLowerCase();
  }

  const result: WikiContext = {
    intro:            introText.trim().slice(0, INTRO_MAX_CHARS) || null,
    history:          null,
    heritage:         null,
    notableResidents: null,
    nameEtymology:    null,
    demographics:     null,
    imageUrl:         null,
  };

  // Regex to find === subsections === within a top-level section body.
  const subSectionRe = /\n===\s*([^=\n]+?)\s*===[ \t]*\n([\s\S]*?)(?=\n==|$)/g;

  for (const { heading, body } of segments) {
    const norm = normalise(heading);
    for (const [key, keywords] of Object.entries(SECTION_TARGETS) as [keyof Omit<WikiContext, "intro">, string[]][]) {
      if (result[key] === null && keywords.some((kw) => norm.startsWith(kw))) {
        // Strip sub-section headings (=== ... ===) from the body so the LLM
        // receives clean prose rather than formatting artefacts.
        const clean = body.replace(/={2,}[^=\n]+=+/g, "").replace(/\n{3,}/g, "\n\n").trim();
        result[key] = clean.slice(0, SECTION_MAX_CHARS) || null;
        break;
      }
    }

    // Some articles bury "Name" or "Etymology" as a === subsection inside
    // == History == (or similar). If we haven't found nameEtymology yet,
    // scan this section's body for a matching subsection.
    if (result.nameEtymology === null) {
      subSectionRe.lastIndex = 0;
      let subMatch: RegExpExecArray | null;
      while ((subMatch = subSectionRe.exec(body)) !== null) {
        const subNorm = subMatch[1].trim().toLowerCase();
        if (SECTION_TARGETS.nameEtymology.some((kw) => subNorm.startsWith(kw))) {
          const subBody = subMatch[2]
            .replace(/={2,}[^=\n]+=+/g, "")
            .replace(/\n{3,}/g, "\n\n")
            .trim();
          if (subBody) {
            result.nameEtymology = subBody.slice(0, SECTION_MAX_CHARS);
          }
          break;
        }
      }
    }
  }

  return result;
}

async function fetchFullArticle(title: string): Promise<WikiContext | null> {
  const params = new URLSearchParams({
    action:      "query",
    prop:        "extracts|pageimages",
    piprop:      "original",
    explaintext: "true",
    titles:      title,
    format:      "json",
    redirects:   "1",
    // No exintro — we want the full article.
  });

  try {
    const res = await fetch(`${WIKI_API}?${params}`, {
      headers: { "User-Agent": "SuburbSurfer/1.0" },
      signal:  AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) return null;

    const data = await res.json();
    const pages: Record<string, { missing?: string; extract?: string }> =
      data?.query?.pages;
    if (!pages) return null;

    const page: any = Object.values(pages)[0];
    // Wikipedia represents missing pages with a "missing" key (value is "").
    if ("missing" in page || !page.extract?.trim()) return null;

    // Pass the full article to parseArticle. Individual sections are capped during parsing.
    const ctx = parseArticle(page.extract);
    ctx.imageUrl = page.original?.source || null;
    return ctx;
  } catch {
    return null;
  }
}

/**
 * Fetches structured Wikipedia context for a suburb.
 * Tries "{suburb}, {state}" first, then "{suburb}" alone.
 * Returns null silently on any error — callers treat this as optional.
 */
export async function fetchSuburbWikiContext(
  suburb: string,
  city:   string
): Promise<WikiContext | null> {
  const state    = CITY_TO_STATE[city];
  const attempts = state ? [`${suburb}, ${state}`, suburb] : [suburb];

  for (const title of attempts) {
    const ctx = await fetchFullArticle(title);
    if (ctx) {
      const sections = Object.entries(ctx)
        .filter(([, v]) => v !== null)
        .map(([k]) => k)
        .join(", ");
      console.log(`[wikipedia] fetched "${title}" — sections: ${sections}`);
      return ctx;
    }
  }

  console.warn(`[wikipedia] no article found for "${suburb}" in ${city}`);
  return null;
}
