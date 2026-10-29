import { Card, CardContent } from "@/components/ui/card";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

interface KpiCardProps {
  label: string;
  value: string;
  hint?: string;
  icon: LucideIcon;
  tone?: "default" | "warning" | "success";
}

const TONE_CLASSES: Record<NonNullable<KpiCardProps["tone"]>, string> = {
  default: "bg-primary/10 text-primary",
  warning: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  success: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
};

export function KpiCard({ label, value, hint, icon: Icon, tone = "default" }: KpiCardProps) {
  return (
    <Card className="transition-shadow hover:shadow-sm">
      <CardContent className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-medium leading-snug text-muted-foreground sm:text-sm">
            {label}
          </p>
          <p className="mt-0.5 text-xl font-semibold tracking-tight tabular-nums sm:text-2xl">
            {value}
          </p>
          {hint ? (
            <p className="mt-0.5 text-xs leading-snug text-muted-foreground">{hint}</p>
          ) : null}
        </div>
        <div
          className={cn(
            "flex size-8 shrink-0 items-center justify-center rounded-lg sm:size-9",
            TONE_CLASSES[tone],
          )}
        >
          <Icon className="size-4" aria-hidden="true" />
        </div>
      </CardContent>
    </Card>
  );
}
