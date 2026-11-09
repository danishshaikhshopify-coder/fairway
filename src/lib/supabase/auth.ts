// Auth rules shared by src/proxy.ts, the browser client, and the node tests.
//
// Deliberately dependency-free: no supabase-js, no next. The proxy bundles
// this file only, and the rules stay importable from `node --test`.

/** Both env vars must be present; either one alone keeps demo mode. */
export function supabaseEnv(): { url: string; anonKey: string } | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) return null;
  return { url, anonKey };
}

/** True when the app should talk to a real Supabase project. */
export function isLiveMode(): boolean {
  return supabaseEnv() !== null;
}

// supabase-js derives its default storage key from the first label of the
// project hostname (`sb-<label>-auth-token`); @supabase/ssr stores that key as
// a cookie and splits long values into `.0`, `.1`, … suffixes. Match both.
const AUTH_COOKIE = /^sb-.*-auth-token(\.\d+)?$/;

/** True when the request carries a non-empty Supabase session cookie. */
export function hasAuthCookie(
  cookies: readonly { name: string; value?: string }[],
): boolean {
  return cookies.some((c) => AUTH_COOKIE.test(c.name) && c.value !== "");
}

/** Routes reachable without a session. */
export function isPublicPath(pathname: string): boolean {
  return (
    pathname === "/login" ||
    pathname.startsWith("/login/") ||
    pathname === "/invite/accept"
  );
}

/**
 * Where the proxy should send this request, or null to serve it unchanged.
 *
 * `?next=` only ever carries an in-app absolute path (never `//host` or a
 * scheme), so it cannot be used as an open redirect.
 *
 * API routes are never redirected: a fetch() caller expects a JSON response
 * (401/403 from requireActor(), or a bearer-secret check for cron routes),
 * not an HTML redirect to /login. Each route enforces its own auth.
 */
export function authRedirect(
  pathname: string,
  hasSession: boolean,
): string | null {
  if (pathname.startsWith("/api/")) return null;
  if (!hasSession && !isPublicPath(pathname)) {
    return `/login?next=${encodeURIComponent(pathname)}`;
  }
  if (hasSession && isPublicPath(pathname)) {
    return "/";
  }
  return null;
}
