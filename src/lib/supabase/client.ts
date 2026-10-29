// Supabase browser client (B2).
//
// Live mode is gated on BOTH NEXT_PUBLIC_SUPABASE_URL and
// NEXT_PUBLIC_SUPABASE_ANON_KEY being present. When either is missing the app
// keeps its original demo behaviour: the mock store, no auth, no network.
// This is the single explicit switch the B1 plan calls for (§11 step 4).
//
// Only the anon (publishable) key belongs here. The service-role key must
// never be read from a NEXT_PUBLIC_ var or imported into client code.

import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseEnv } from "./auth";

export { isLiveMode, supabaseEnv } from "./auth";

let client: SupabaseClient | null = null;

/** Browser client, or null in demo mode. Safe to call during render. */
export function getSupabase(): SupabaseClient | null {
  if (client) return client;
  const env = supabaseEnv();
  if (!env) return null;
  // @supabase/ssr keeps the session in cookies (document.cookie in the
  // browser) so src/proxy.ts can read it on the server, which a plain
  // localStorage-backed createClient cannot do. Only auth options are set;
  // everything else is the library default.
  client = createBrowserClient(env.url, env.anonKey, {
    auth: { flowType: "pkce" },
  });
  return client;
}
