/**
 * Robustly extracts and parses a JSON object from a Gemini response string.
 *
 * Gemini 2.5 Flash sometimes wraps output in ```json ... ``` fences or adds
 * a thinking preamble even when instructed not to. This strips all that away
 * and finds the first complete { ... } block before parsing.
 */
export function parseGeminiJson<T>(raw: string): T {
  let text = raw.trim();

  // Strip <think>...</think> reasoning blocks (some models emit these)
  text = text.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();

  // Strip ```json ... ``` or ``` ... ``` fences
  text = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();

  // Find the outermost { ... } block in case there's preamble/postamble
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");

  if (start === -1 || end === -1 || end < start) {
    throw new Error(`No valid JSON object found in model response. Raw: ${raw.slice(0, 200)}`);
  }

  return JSON.parse(text.slice(start, end + 1)) as T;
}
