import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";
import { NextResponse } from "next/server";

/**
 * 15 requests per 60-second sliding window per IP.
 * Generous enough for any real user, restrictive enough to stop scripts.
 *
 * Lazy-initialised so the app still boots cleanly if the env vars
 * aren't set (e.g. local dev without an Upstash account).
 */
let ratelimit: Ratelimit | null = null;

function getRatelimit(): Ratelimit | null {
  if (ratelimit) return ratelimit;

  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;

  if (!url || !token) return null;

  ratelimit = new Ratelimit({
    redis: new Redis({ url, token }),
    limiter: Ratelimit.slidingWindow(15, "60 s"),
    analytics: true,
    prefix: "suburb_surfer",
  });

  return ratelimit;
}

/**
 * Checks the rate limit for the incoming request.
 * Returns `{ limited: false }` if the request is allowed (or if Upstash
 * isn't configured), or `{ limited: true, response }` to return immediately.
 */
export async function checkRateLimit(
  request: Request
): Promise<{ limited: false } | { limited: true; response: NextResponse }> {
  const rl = getRatelimit();

  if (!rl) return { limited: false };

  const forwarded = request.headers.get("x-forwarded-for");
  const ip =
    (forwarded ? forwarded.split(",")[0].trim() : null) ??
    request.headers.get("x-real-ip") ??
    "anonymous";

  const { success, limit, remaining, reset } = await rl.limit(ip);

  if (!success) {
    const retryAfter = Math.ceil((reset - Date.now()) / 1000);
    console.warn(
      `[rate-limit] IP ${ip} exceeded limit (${limit} req/min). Retry after ${retryAfter}s.`
    );

    return {
      limited: true,
      response: NextResponse.json(
        { error: "We're getting too many requests right now. Please try again in a moment." },
        {
          status: 429,
          headers: {
            "X-RateLimit-Limit": String(limit),
            "X-RateLimit-Remaining": String(remaining),
            "Retry-After": String(retryAfter),
          },
        }
      ),
    };
  }

  return { limited: false };
}
