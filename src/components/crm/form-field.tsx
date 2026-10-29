"use client";

import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { useId, type ReactNode } from "react";

interface FormFieldProps {
  label: string;
  required?: boolean;
  error?: string;
  className?: string;
  children: (props: {
    id: string;
    "aria-invalid": boolean | undefined;
    "aria-describedby": string | undefined;
    "aria-required": boolean | undefined;
  }) => ReactNode;
}

/** Wraps a control with a label and an inline error message. */
export function FormField({ label, required, error, className, children }: FormFieldProps) {
  const id = useId();
  const errorId = `${id}-error`;

  return (
    <div className={cn("space-y-1.5", className)}>
      <Label htmlFor={id}>
        {label}
        {required ? (
          <span className="text-destructive" aria-hidden="true">
            {" *"}
          </span>
        ) : null}
      </Label>
      {children({
        id,
        "aria-invalid": error ? true : undefined,
        "aria-describedby": error ? errorId : undefined,
        "aria-required": required || undefined,
      })}
      {error ? (
        <p id={errorId} className="text-xs text-destructive" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
