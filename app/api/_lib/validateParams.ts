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
 * Capitalises the first Unicode letter after the start of the string or any
 * word boundary character (space, hyphen). Handles names like "Brighton-Le-Sands"
 * and "O'Connor" correctly.
 */
function toTitleCase(s: string): string {
  return s.replace(/(^|[\s\-])(\p{L})/gu, (_, sep, letter) => sep + letter.toUpperCase());
}

/**
 * Sanitises a suburb name: trims whitespace, enforces max length, strips
 * invalid characters, then normalises to title case so "denham court" and
 * "Denham Court" are treated identically downstream.
 *
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
  return toTitleCase(trimmed);
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
