export const VALID_CITIES = new Set([
  "Sydney",
  "Melbourne",
  "Brisbane",
  "Perth",
  "Adelaide",
  "Canberra",
  "Hobart",
  "Darwin",
]);

/**
 * Validates the city param against the known allowlist.
 * Returns the city string if valid, null otherwise.
 */
export function validateCity(raw: string | null): string | null {
  if (!raw || !VALID_CITIES.has(raw)) return null;
  return raw;
}

/**
 * Sanitises a suburb name: trims whitespace, enforces max length,
 * and strips characters that have no place in a suburb name.
 * Allows Unicode letters (covers accented/non-Latin names), spaces,
 * hyphens, apostrophes, and periods.
 *
 * Returns the cleaned string if valid, null if it should be rejected.
 */
export function sanitiseSuburb(raw: string | null): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (trimmed.length === 0 || trimmed.length > 100) return null;
  if (!/^[\p{L}\s\-'.]+$/u.test(trimmed)) return null;
  return trimmed;
}

/**
 * Sanitises the exclude list for the food route.
 * Caps total items and individual item length to prevent prompt bloat.
 */
export function sanitiseExclude(raw: string | null): string[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((s) => s.trim().slice(0, 80))
    .filter(Boolean)
    .slice(0, 20);
}
