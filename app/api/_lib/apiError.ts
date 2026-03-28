import OpenAI from "openai";
import { NextResponse } from "next/server";

export function handleApiError(context: string, err: unknown): NextResponse {
  const isOpenAIError = err instanceof OpenAI.APIError;
  const httpStatus = isOpenAIError ? err.status : 500;
  const message = isOpenAIError
    ? err.message
    : err instanceof Error
      ? err.message
      : String(err);

  if (httpStatus === 429) {
    console.error(
      `\n[${context}] ── 429 rate limit from Groq ────────────────────\n` +
      `  Raw reason: ${message}\n` +
      `  Usage     : https://console.groq.com/settings/limits\n` +
      `  Swap model: app/api/_lib/groqClient.ts\n` +
      `  Models    : https://console.groq.com/docs/models\n` +
      `────────────────────────────────────────────────────\n`
    );

    return NextResponse.json(
      { error: "We're getting too many requests right now. Please try again in a moment." },
      { status: 429 }
    );
  }

  console.error(
    `\n[${context}] ── ${httpStatus} error ──────────────────────────────\n` +
    `  ${message}\n` +
    `────────────────────────────────────────────────────\n`
  );

  return NextResponse.json(
    { error: "Something went wrong on our end. Please try again." },
    { status: httpStatus >= 400 ? httpStatus : 500 }
  );
}
