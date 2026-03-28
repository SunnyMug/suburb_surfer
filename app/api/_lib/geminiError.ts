import { NextResponse } from "next/server";

export const GEMINI_MODEL = "gemini-2.5-flash-lite";

/**
 * Inspects a caught error from the Gemini SDK and returns an appropriate
 * NextResponse. Surfaces 429 rate-limit errors as a distinct status so the
 * frontend can show a specific message instead of a generic server error.
 */
export function handleGeminiError(context: string, err: unknown): NextResponse {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`[${context}] error:`, message);

  // Detect RESOURCE_EXHAUSTED / 429 from the Gemini API
  const isRateLimit =
    message.includes("RESOURCE_EXHAUSTED") ||
    message.includes('"code":429') ||
    message.includes("quota");

  if (isRateLimit) {
    // Try to extract the suggested retry delay from the error payload
    const retryMatch = message.match(/retryDelay["\s:]+(\d+)/);
    const retrySeconds = retryMatch ? parseInt(retryMatch[1], 10) : 60;

    return NextResponse.json(
      {
        error: `Rate limit reached. The free tier allows a limited number of requests per day. Please wait ${retrySeconds} seconds and try again, or check your Gemini API quota at https://ai.dev/rate-limit`,
      },
      { status: 429 }
    );
  }

  return NextResponse.json(
    { error: `${context}: ${message}` },
    { status: 500 }
  );
}
