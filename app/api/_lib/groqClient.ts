import OpenAI from "openai";

/**
 * Model cascade — tried in order on 429 or timeout.
 */
export const MODELS = [
  "openai/gpt-oss-120b",   // 1,000 RPD — best quality
  "qwen/qwen3.8-27b",      // 14,400 RPD — very fast fallback
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
 * Sends a single-turn prompt, falling back through `models` on 429 or timeout.
 * Defaults to the full MODELS cascade; pass a custom list to pin a specific model.
 * Strips <think>...</think> reasoning blocks that some models emit.
 */
export async function generate(
  client: OpenAI,
  prompt: string,
  models: string[] = MODELS
): Promise<string> {
  let lastError: unknown;

  for (let i = 0; i < models.length; i++) {
    const model = models[i];
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

    try {
      console.log(`[groq] trying model: ${model}`);

      const response = await client.chat.completions.create(
        {
          model,
          messages: [{ role: "user", content: prompt }],
          response_format: { type: "json_object" },
          temperature: 0.8,        // slightly below default (1.0) for focused factual output
          frequency_penalty: 0.6,  // discourages repetitive phrasing within a response
          presence_penalty: 0.3,   // encourages broader vocabulary choices
        },
        { signal: controller.signal }
      );

      clearTimeout(timer);
      const content = response.choices[0]?.message?.content ?? "";
      return content.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
    } catch (err) {
      clearTimeout(timer);

      const isTimeout = err instanceof Error && err.name === "AbortError";
      const is429 = err instanceof OpenAI.APIError && err.status === 429;
      const shouldFallback = (is429 || isTimeout) && i < models.length - 1;

      if (shouldFallback) {
        const reason = isTimeout ? `timed out after ${TIMEOUT_MS / 1000}s` : "returned 429";
        console.warn(`[groq] ${model} ${reason} — falling back to ${models[i + 1]}`);
        lastError = err;
        continue;
      }

      throw err;
    }
  }

  throw lastError;
}
