// Shared motion constants so every animated surface in the app moves on the
// same curve and timing instead of each component inventing its own.
import type { Transition, Variants } from "motion/react";

export const EASE_PREMIUM: Transition["ease"] = [0.16, 1, 0.3, 1];

export const DURATION = {
  fast: 0.12,
  base: 0.2,
  slow: 0.32,
} as const;

/** Snappy entrance spring: quick settle with a small single overshoot. */
export const SPRING_SNAPPY: Transition = {
  type: "spring",
  stiffness: 420,
  damping: 32,
  mass: 0.9,
};

/** One short fade + rise, used for anything entering the page or a panel. */
export const fadeUp: Variants = {
  hidden: { opacity: 0, y: 6 },
  show: {
    opacity: 1,
    y: 0,
    transition: SPRING_SNAPPY,
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
    transition: SPRING_SNAPPY,
  },
  exit: {
    opacity: 0,
    y: -4,
    scale: 0.98,
    transition: { duration: DURATION.fast, ease: EASE_PREMIUM },
  },
};
