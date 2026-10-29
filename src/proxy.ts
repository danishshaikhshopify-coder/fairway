// Route gate (Next 16 renamed `middleware` to `proxy`).
//
// This is an OPTIMISTIC check only: it looks for a Supabase session cookie and
// redirects, without touching the network or the database — proxy runs on
// every request including prefetched navigations, so anything slower would
// cost latency on every click. RLS is the real data boundary; this only keeps
// signed-out browsers out of the CRM shell.
//
// No-op in demo mode, so the env-less build keeps its original behaviour.
//
// The proxy runs on the Node.js runtime by default; the `runtime` segment
// config is not allowed in proxy files.

import { NextResponse, type NextRequest } from "next/server";
import { authRedirect, hasAuthCookie, isLiveMode } from "@/lib/supabase/auth";

export default function proxy(req: NextRequest) {
  if (!isLiveMode()) return NextResponse.next();

  const target = authRedirect(
    req.nextUrl.pathname,
    hasAuthCookie(req.cookies.getAll()),
  );
  return target
    ? NextResponse.redirect(new URL(target, req.url))
    : NextResponse.next();
}

export const config = {
  // Everything except static assets, images, and any dotted path (favicon,
  // files under /public). No /api routes exist, so none are listed.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\..*).*)"],
};
