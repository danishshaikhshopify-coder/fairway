import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

/** A small keycap for a keyboard shortcut hint. */
export function Kbd({ className, ...props }: ComponentProps<"kbd">) {
  return (
    <kbd
      data-slot="kbd"
      className={cn(
        "inline-flex h-5 min-w-5 items-center justify-center rounded-md border border-border bg-muted px-1 font-mono text-[11px] text-muted-foreground",
        className,
      )}
      {...props}
    />
  );
}
