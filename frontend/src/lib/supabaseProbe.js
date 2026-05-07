import supabase from "./supabaseClient";

/**
 * Fetches from `profiles` and logs the outcome. Safe to run when signed out:
 * RLS may return an empty array without error (still "connected").
 */
export async function testSupabaseProfiles() {
  const url = import.meta.env.VITE_SUPABASE_URL;
  const key = import.meta.env.VITE_SUPABASE_ANON_KEY;

  if (!url?.trim() || !key?.trim()) {
    console.error(
      "[Supabase verify] Not connected — missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY."
    );
    return { ok: false, reason: "missing_env" };
  }

  console.log("[Supabase verify] GET profiles (limit 1)...");

  const { data, error } = await supabase
    .from("profiles")
    .select("id, username")
    .limit(1);

  if (error) {
    console.error("[Supabase verify] Error:", error.message, error);
    const msg = (error.message || "").toLowerCase();
    if (msg.includes("invalid api key") || msg.includes("jwt")) {
      console.info(
        "[Supabase verify] Fix: Project Settings → API → copy anon (or publishable) key into VITE_SUPABASE_ANON_KEY."
      );
    }
    if (msg.includes("failed to fetch") || msg.includes("network")) {
      console.info(
        "[Supabase verify] Fix: check URL, VPN/firewall, and browser Network tab for blocked requests."
      );
    }
    if (
      error.code === "PGRST301" ||
      msg.includes("permission denied") ||
      msg.includes("row-level security")
    ) {
      console.info(
        "[Supabase verify] Fix: RLS/policies — sign in as a user allowed to SELECT profiles, or adjust policies."
      );
    }
    return { ok: false, error };
  }

  console.log(
    "[Supabase verify] Supabase connected successfully. Sample:",
    data
  );
  return { ok: true, data };
}
