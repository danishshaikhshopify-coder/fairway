// Centralized app-URL config — the fix for invites/redirects landing on
// localhost in production. No DOM, no network: `node --test` runs this
// directly against the source.
import assert from "node:assert/strict";
import test from "node:test";
import { AppUrlConfigError, getAppUrl } from "../src/lib/app-url.ts";

const NODE_ENV_KEY = "NODE_ENV";
const APP_URL_KEY = "NEXT_PUBLIC_APP_URL";

const env = process.env as Record<string, string | undefined>;

function withEnv(nodeEnv: string | undefined, appUrl: string | undefined, run: () => void) {
  const prev = { nodeEnv: env[NODE_ENV_KEY], appUrl: env[APP_URL_KEY] };
  if (nodeEnv === undefined) delete env[NODE_ENV_KEY];
  else env[NODE_ENV_KEY] = nodeEnv;
  if (appUrl === undefined) delete env[APP_URL_KEY];
  else env[APP_URL_KEY] = appUrl;
  try {
    run();
  } finally {
    if (prev.nodeEnv === undefined) delete env[NODE_ENV_KEY];
    else env[NODE_ENV_KEY] = prev.nodeEnv;
    if (prev.appUrl === undefined) delete env[APP_URL_KEY];
    else env[APP_URL_KEY] = prev.appUrl;
  }
}

test("local dev always resolves to localhost, even with NEXT_PUBLIC_APP_URL unset", () => {
  withEnv("development", undefined, () => {
    assert.equal(getAppUrl(), "http://localhost:3000");
  });
});

test("local dev honors an explicit override", () => {
  withEnv("development", "http://localhost:4000", () => {
    assert.equal(getAppUrl(), "http://localhost:4000");
  });
});

test("production with no NEXT_PUBLIC_APP_URL fails safely instead of falling back to localhost", () => {
  withEnv("production", undefined, () => {
    assert.throws(() => getAppUrl(), AppUrlConfigError);
  });
});

test("production rejects a localhost NEXT_PUBLIC_APP_URL instead of using it", () => {
  withEnv("production", "http://localhost:3000", () => {
    assert.throws(() => getAppUrl(), AppUrlConfigError);
  });
  withEnv("production", "http://127.0.0.1:3000", () => {
    assert.throws(() => getAppUrl(), AppUrlConfigError);
  });
});

test("production rejects a malformed NEXT_PUBLIC_APP_URL", () => {
  withEnv("production", "not-a-url", () => {
    assert.throws(() => getAppUrl(), AppUrlConfigError);
  });
});

test("production with a real configured URL returns its origin", () => {
  withEnv("production", "https://fairway-crm-one.vercel.app", () => {
    assert.equal(getAppUrl(), "https://fairway-crm-one.vercel.app");
  });
  withEnv("production", "https://fairway-crm-one.vercel.app/some/path?x=1", () => {
    assert.equal(getAppUrl(), "https://fairway-crm-one.vercel.app");
  });
});
