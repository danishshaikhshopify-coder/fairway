"use client";

// Composes the auth + CRM providers for the root layout.
//
// Split out of the layout (a server component) because re-keying the CRM store
// needs the session, and because crm-store already imports from auth-context —
// importing it back the other way would make a cycle.

import type { ReactNode } from "react";
import { AuthProvider, useAuth } from "@/lib/auth-context";
import { CrmProvider } from "@/lib/crm-store";

function CrmForSession({ children }: { children: ReactNode }) {
  // Re-key on the signed-in user. Root layouts survive client navigations, so
  // without this a cross-tab sign-out followed by someone else signing in would
  // briefly show the previous session's rows. Demo mode and the signed-out
  // state share one stable key, so nothing remounts there.
  const { session } = useAuth();
  return (
    <CrmProvider key={session?.user.id ?? "anonymous"}>{children}</CrmProvider>
  );
}

export function Providers({ children }: { children: ReactNode }) {
  return (
    <AuthProvider>
      <CrmForSession>{children}</CrmForSession>
    </AuthProvider>
  );
}
