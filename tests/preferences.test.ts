import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_PREFERENCES,
  loadPreferences,
  savePreferences,
} from "../src/lib/preferences.ts";
import { OWNERS } from "../src/lib/types.ts";

const KEY = "fairway.prefs.v1";
const g = globalThis as { window?: unknown };

// Fake window.localStorage backed by a Map, installed only for `run`.
function withStorage(
  run: () => void,
  initial: Record<string, string> = {},
  opts: { throwOnSet?: boolean } = {},
) {
  const store = new Map<string, string>(Object.entries(initial));
  g.window = {
    localStorage: {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => {
        if (opts.throwOnSet) throw new Error("QuotaExceeded");
        store.set(k, v);
      },
    },
  };
  try {
    run();
  } finally {
    Reflect.deleteProperty(g, "window");
  }
}

test("loadPreferences returns defaults without a window (SSR/prerender)", () => {
  Reflect.deleteProperty(g, "window");
  assert.deepEqual(loadPreferences(), DEFAULT_PREFERENCES);
});

test("save → load round-trips valid preferences", () => {
  withStorage(() => {
    savePreferences({ defaultOwner: "J. Chen", followUpDays: 14, currency: "CAD" });
    assert.deepEqual(loadPreferences(), {
      defaultOwner: "J. Chen",
      followUpDays: 14,
      currency: "CAD",
    });
  });
});

test("corrupt JSON falls back to defaults", () => {
  withStorage(() => {
    assert.deepEqual(loadPreferences(), DEFAULT_PREFERENCES);
  }, { [KEY]: "{not json" });
});

test("out-of-range or non-numeric followUpDays falls back to the default", () => {
  withStorage(() => {
    assert.equal(loadPreferences().followUpDays, DEFAULT_PREFERENCES.followUpDays);
  }, { [KEY]: JSON.stringify({ followUpDays: 999, defaultOwner: OWNERS[0] }) });
});

test("unknown owner and currency fall back to defaults", () => {
  withStorage(() => {
    const prefs = loadPreferences();
    assert.equal(prefs.defaultOwner, DEFAULT_PREFERENCES.defaultOwner);
    assert.equal(prefs.currency, "USD");
  }, {
    [KEY]: JSON.stringify({ defaultOwner: "Not An Owner", currency: "EUR" }),
  });
});

test("savePreferences survives storage failures", () => {
  withStorage(() => {
    assert.doesNotThrow(() =>
      savePreferences({ ...DEFAULT_PREFERENCES, followUpDays: 7 }),
    );
  }, {}, { throwOnSet: true });
});
