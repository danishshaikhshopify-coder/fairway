// Centralized, environment-aware application origin.
//
// Local dev (`next dev`, NODE_ENV=development) always resolves to
// http://localhost:3000. Every deployed environment (NODE_ENV=production,
// which Next.js sets for both preview and production builds) must have
// NEXT_PUBLIC_APP_URL configured to the real deployed origin — there is no
// fallback to localhost. Callers that build links users receive (invite
// emails, auth redirects) must surface this as a failure, not silently
// email/redirect to a dev server that does not exist for the recipient.

const LOCALHOST_DEV_URL = "http://localhost:3000";

export class AppUrlConfigError extends Error {}

export function getAppUrl(): string {
  const configured = process.env.NEXT_PUBLIC_APP_URL;

  if (process.env.NODE_ENV !== "production") {
    return configured || LOCALHOST_DEV_URL;
  }

  if (!configured) {
    throw new AppUrlConfigError("NEXT_PUBLIC_APP_URL is not configured in production.");
  }

  let url: URL;
  try {
    url = new URL(configured);
  } catch {
    throw new AppUrlConfigError(`NEXT_PUBLIC_APP_URL is not a valid URL: ${configured}`);
  }
  if (url.hostname === "localhost" || url.hostname === "127.0.0.1") {
    throw new AppUrlConfigError(`NEXT_PUBLIC_APP_URL is set to localhost in production: ${configured}`);
  }

  return url.origin;
}
