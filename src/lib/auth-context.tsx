"use client";

// Session state for the whole app. Lives in lib (not components) because
// src/lib/crm-store.tsx needs it to decide when live data may be fetched.
//
// Demo mode: no provider is required — the default context below already
// reports "not live, ready, no session", so components keep working without
// one. Live mode: <AuthProvider> sits above <CrmProvider> in the root layout.

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { usePathname, useRouter } from "next/navigation";
import type { Session } from "@supabase/supabase-js";
import { isPublicPath } from "@/lib/supabase/auth";
import { getSupabase, isLiveMode } from "@/lib/supabase/client";

type AuthState = {
  /** True when a Supabase project is configured. */
  live: boolean;
  /** False until the stored session has been read (always true in demo mode). */
  ready: boolean;
  session: Session | null;
};

const DEMO_AUTH: AuthState = { live: false, ready: true, session: null };
const AuthContext = createContext<AuthState>(DEMO_AUTH);

export function AuthProvider({ children }: { children: ReactNode }) {
  const live = isLiveMode();
  const pathname = usePathname();
  const router = useRouter();
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(!live);

  useEffect(() => {
    if (!live) return;
    // Null is unreachable while live (live mode means both env vars are set),
    // but never construct a client on the server path by accident.
    const db = getSupabase();
    if (!db) return;
    let cancelled = false;
    db.auth.getSession().then(({ data }) => {
      if (cancelled) return;
      setSession(data.session);
      setReady(true);
    });
    // Covers token refresh, sign-in, sign-out from another tab, and expiry.
    const { data: sub } = db.auth.onAuthStateChange((_event, next) => {
      setSession(next);
      setReady(true);
    });
    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
  }, [live]);

  // src/proxy.ts may only look for a cookie, so a cookie that no longer holds
  // a valid session would otherwise land the user in an empty CRM.
  useEffect(() => {
    if (!live || !ready || session || isPublicPath(pathname)) return;
    router.replace("/login");
  }, [live, ready, session, pathname, router]);

  const value = useMemo<AuthState>(
    () => ({ live, ready, session }),
    [live, ready, session],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  return useContext(AuthContext);
}
