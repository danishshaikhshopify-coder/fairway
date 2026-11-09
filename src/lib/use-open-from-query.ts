"use client";

import { useEffect } from "react";

/**
 * Runs `onOpen` once on mount when `?<param>=1` is in the URL (e.g. the
 * command palette's "New lead" linking to `/leads?new=1`), then strips the
 * param so a refresh or back-navigation doesn't reopen it. Deferred one tick
 * for the same hydration-safety reason as the existing `?lead=` deep link:
 * the first client render must still match the prerendered HTML.
 */
export function useOpenFromQuery(param: string, onOpen: () => void) {
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get(param) !== "1") return;
    const timer = setTimeout(() => {
      onOpen();
      const url = new URL(window.location.href);
      url.searchParams.delete(param);
      window.history.replaceState({}, "", url.toString());
    }, 0);
    return () => clearTimeout(timer);
    // Only on mount, same as the ?lead= deep link this mirrors.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
