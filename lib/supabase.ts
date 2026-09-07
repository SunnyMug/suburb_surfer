import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { SuburbData } from "./types";

const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

let supabaseInstance: SupabaseClient | null = null;

export function getSupabaseClient(): SupabaseClient | null {
  if (supabaseInstance) return supabaseInstance;
  if (!supabaseUrl || !supabaseKey) {
    return null;
  }
  try {
    supabaseInstance = createClient(supabaseUrl, supabaseKey, {
      auth: { persistSession: false },
    });
    return supabaseInstance;
  } catch (err) {
    console.warn("[supabase] failed to initialize client:", err);
    return null;
  }
}

/**
 * Checks if a suburb is already cached in Supabase.
 * Returns the SuburbData or null if missing / Supabase not configured.
 */
export async function getCachedSuburbFromSupabase(
  city: string,
  suburb: string
): Promise<SuburbData | null> {
  const client = getSupabaseClient();
  if (!client) return null;

  try {
    const { data, error } = await client
      .from("suburb_cache")
      .select("data")
      .ilike("city", city.trim())
      .ilike("suburb", suburb.trim())
      .maybeSingle();

    if (error) {
      console.warn(`[supabase] cache lookup error for "${suburb}, ${city}":`, error.message);
      return null;
    }

    if (data?.data) {
      console.log(`[supabase] cache HIT for "${suburb}, ${city}"`);
      return data.data as SuburbData;
    }

    return null;
  } catch (err) {
    console.warn(`[supabase] lookup exception:`, err);
    return null;
  }
}

/**
 * Saves or updates an explored suburb in Supabase so future queries are instantaneous.
 */
export async function saveCachedSuburbToSupabase(
  city: string,
  suburb: string,
  suburbData: SuburbData
): Promise<void> {
  const client = getSupabaseClient();
  if (!client) return;

  try {
    const { error } = await client
      .from("suburb_cache")
      .upsert(
        {
          city: city.trim(),
          suburb: suburb.trim(),
          data: suburbData,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "city,suburb" }
      );

    if (error) {
      console.warn(`[supabase] failed to cache "${suburb}, ${city}":`, error.message);
    } else {
      console.log(`[supabase] successfully cached "${suburb}, ${city}"`);
    }
  } catch (err) {
    console.warn(`[supabase] save exception:`, err);
  }
}
