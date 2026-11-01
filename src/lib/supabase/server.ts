// Server-only Supabase clients for Route Handlers.
//
// * `getServerSupabase()` uses the caller's auth cookies, so every query runs
//   under RLS exactly like the browser client.
// * `getServiceSupabase()` uses the service-role key and MUST only be used
//   after the caller's workspace membership has been verified. It exists for
//   audit-log writes (sheet_sync_runs has no client write policy) and for the
//   scheduled cron, which has no user session.
//
// Neither function ever returns a key to the caller.

import { createServerClient } from "@supabase/ssr";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { supabaseEnv } from "./auth";

export async function getServerSupabase(): Promise<SupabaseClient | null> {
  const env = supabaseEnv();
  if (!env) return null;
  const cookieStore = await cookies();
  return createServerClient(env.url, env.anonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Route handlers may write cookies; Server Components cannot. A
          // refresh that happens during a read is harmless to skip.
        }
      },
    },
    auth: { flowType: "pkce" },
  });
}

export function getServiceSupabase(): SupabaseClient | null {
  const env = supabaseEnv();
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!env || !serviceKey) return null;
  return createClient(env.url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export function serviceRoleConfigured(): boolean {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY,
  );
}
