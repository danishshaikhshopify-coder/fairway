"use client";

import { useSyncExternalStore } from "react";

import { todayIso } from "./format";

// `new Date()` during render is an unstable value for Next.js prerendering
// (Cache Components). Reading "today" through useSyncExternalStore renders the
// empty string on the server and recomputes on the client after hydration —
// same pattern as theme-toggle.tsx.
const subscribeNoop = () => () => {};
const getServerSnapshot = () => "";
const getClientSnapshot = () => todayIso();

/** Today's date as "YYYY-MM-DD" ("" during server render). */
export function useToday(): string {
  return useSyncExternalStore(subscribeNoop, getClientSnapshot, getServerSnapshot);
}
