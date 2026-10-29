"use client";

// Session-persistent CRM preferences (Settings page → used by the add-lead
// form). localStorage only — no backend, mirrors the demo-mode contract.

import { OWNERS } from "./types.ts";

export interface CrmPreferences {
  defaultOwner: string;
  followUpDays: number;
  currency: "USD" | "CAD" | "MXN";
}

const KEY = "fairway.prefs.v1";

export const DEFAULT_PREFERENCES: CrmPreferences = {
  defaultOwner: OWNERS[0],
  followUpDays: 3, // matches the default shown on the Settings → CRM form
  currency: "USD",
};

/** Read preferences; tolerant of missing/corrupt storage. Client-only. */
export function loadPreferences(): CrmPreferences {
  if (typeof window === "undefined") return DEFAULT_PREFERENCES;
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return DEFAULT_PREFERENCES;
    const parsed = JSON.parse(raw) as Partial<CrmPreferences>;
    return {
      defaultOwner:
        typeof parsed.defaultOwner === "string" &&
        OWNERS.includes(parsed.defaultOwner)
          ? parsed.defaultOwner
          : DEFAULT_PREFERENCES.defaultOwner,
      followUpDays:
        typeof parsed.followUpDays === "number" &&
        Number.isFinite(parsed.followUpDays) &&
        parsed.followUpDays >= 1 &&
        parsed.followUpDays <= 30
          ? parsed.followUpDays
          : DEFAULT_PREFERENCES.followUpDays,
      currency:
        parsed.currency === "CAD" || parsed.currency === "MXN"
          ? parsed.currency
          : "USD",
    };
  } catch {
    return DEFAULT_PREFERENCES;
  }
}

export function savePreferences(prefs: CrmPreferences): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(prefs));
  } catch {
    // Storage full or blocked — preferences just don't persist.
  }
}
