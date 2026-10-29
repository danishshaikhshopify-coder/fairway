"use client";

import { useSyncExternalStore } from "react";
import { useTheme } from "next-themes";
import { Check, Monitor, Moon, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const THEMES = [
  { value: "light", label: "Light", Icon: Sun },
  { value: "dark", label: "Dark", Icon: Moon },
  { value: "system", label: "System", Icon: Monitor },
] as const;

// useSyncExternalStore requires stable function identities: no external system,
// the value only flips from the server snapshot to the client snapshot.
const subscribeNoop = () => () => {};
const getIsClient = () => true;
const getIsServer = () => false;

export function ThemeToggle() {
  // next-themes reads localStorage/theme only on the client. Rendering anything
  // theme-dependent before hydration causes a mismatch, so we render a neutral
  // "system" icon on the server and on the first client render, then swap in the
  // resolved theme. useSyncExternalStore gives the server snapshot (false) and the
  // client snapshot (true) without a setState-in-effect render cascade.
  const mounted = useSyncExternalStore(
    subscribeNoop,
    getIsClient,
    getIsServer,
  );
  const { theme, setTheme } = useTheme();

  const active = mounted ? (theme ?? "system") : null;
  const ActiveIcon =
    THEMES.find((t) => t.value === active)?.Icon ?? Monitor;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={<Button variant="outline" size="icon" aria-label="Change theme" />}
      >
        <ActiveIcon aria-hidden="true" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel>Theme</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {THEMES.map(({ value, label, Icon }) => (
          <DropdownMenuItem key={value} onClick={() => setTheme(value)}>
            <Icon aria-hidden="true" />
            <span>{label}</span>
            {active === value ? (
              <Check aria-hidden="true" className="ml-auto" />
            ) : null}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
