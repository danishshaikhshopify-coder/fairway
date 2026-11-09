"use client";

import { useLayoutEffect, useRef, useState } from "react";
import { animate, useReducedMotion } from "motion/react";
import { EASE_PREMIUM } from "@/lib/motion";

/** Tweens a KPI/stat number from its previous value to the next one. */
export function AnimatedNumber({
  value,
  format = (v) => String(Math.round(v)),
  duration = 0.6,
}: {
  value: number;
  format?: (value: number) => string;
  duration?: number;
}) {
  const [display, setDisplay] = useState(0);
  const prevValue = useRef(0);
  const prefersReduced = useReducedMotion();

  useLayoutEffect(() => {
    if (prefersReduced) return;
    const from = prevValue.current;
    const controls = animate(from, value, {
      duration,
      ease: EASE_PREMIUM,
      onUpdate: setDisplay,
    });
    prevValue.current = value;
    return () => controls.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, prefersReduced]);

  return <>{format(prefersReduced ? value : display)}</>;
}
