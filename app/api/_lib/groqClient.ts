import OpenAI from "openai";

/**
 * Model cascade — tried in order on 429 or timeout.
 * Browse available models at: https://console.groq.com/docs/models
 */
export const MODELS = [
  "llama-3.3-70b-versatile",   // 1,000 RPD — best quality
  "llama-3.1-8b-instant",      // 14,400 RPD — very fast fallback
];

/** Max ms to wait per model before aborting and trying the next. */
const TIMEOUT_MS = 20_000;

export function createClient(apiKey: string): OpenAI {
  return new OpenAI({
    baseURL: "https://api.groq.com/openai/v1",
    apiKey,
  });
}

/**
 * Sends a single-turn prompt, falling back through MODELS on 429 or timeout.
 * Strips <think>...</think> reasoning blocks that some models emit.
 */
export async function generate(client: OpenAI, prompt: string): Promise<string> {
  let lastError: unknown;

  for (let i = 0; i < MODELS.length; i++) {
    const model = MODELS[i];
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

    try {
      console.log(`[groq] trying model: ${model}`);

      const response = await client.chat.completions.create(
        { model, messages: [{ role: "user", content: prompt }] },
        { signal: controller.signal }
      );

      clearTimeout(timer);
      const content = response.choices[0]?.message?.content ?? "";
      return content.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
    } catch (err) {
      clearTimeout(timer);

      const isTimeout = err instanceof Error && err.name === "AbortError";
      const is429 = err instanceof OpenAI.APIError && err.status === 429;
      const shouldFallback = (is429 || isTimeout) && i < MODELS.length - 1;

      if (shouldFallback) {
        const reason = isTimeout ? `timed out after ${TIMEOUT_MS / 1000}s` : "returned 429";
        console.warn(`[groq] ${model} ${reason} — falling back to ${MODELS[i + 1]}`);
        lastError = err;
        continue;
      }

      throw err;
    }
  }

  throw lastError;
}
