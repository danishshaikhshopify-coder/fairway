// Shared motion constants so every animated surface in the app moves on the
// same curve and timing instead of each component inventing its own.
import type { Transition, Variants } from "motion/react";

export const EASE_PREMIUM: Transition["ease"] = [0.16, 1, 0.3, 1];

export const DURATION = {
  fast: 0.12,
  base: 0.2,
  slow: 0.32,
} as const;

/** One short fade + rise, used for anything entering the page or a panel. */
export const fadeUp: Variants = {
  hidden: { opacity: 0, y: 6 },
  show: {
    opacity: 1,
    y: 0,
    transition: { duration: DURATION.base, ease: EASE_PREMIUM },
  },
};

/** Wrap a list of fadeUp children in this to get a small top-to-bottom stagger. */
export const staggerList: Variants = {
  hidden: {},
  show: {
    transition: { staggerChildren: 0.04, delayChildren: 0.02 },
  },
};

/** Popovers, dropdowns, command palette: fade + a few px rise, nothing bouncy. */
export const popIn: Variants = {
  hidden: { opacity: 0, y: -4, scale: 0.98 },
  show: {
    opacity: 1,
    y: 0,
    scale: 1,
    transition: { duration: DURATION.fast, ease: EASE_PREMIUM },
  },
  exit: {
    opacity: 0,
    y: -4,
    scale: 0.98,
    transition: { duration: DURATION.fast, ease: EASE_PREMIUM },
  },
};
