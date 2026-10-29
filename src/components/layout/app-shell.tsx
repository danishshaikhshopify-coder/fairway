"use client";

import { useState, type ReactNode } from "react";
import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import type { LucideIcon } from "lucide-react";
import {
  Activity,
  BarChart3,
  Building2,
  LayoutDashboard,
  Lightbulb,
  ListTodo,
  LoaderCircle,
  LogOut,
  Menu,
  Settings,
  Target,
  TrendingUp,
  Users,
} from "lucide-react";
import { ThemeToggle } from "@/components/theme-toggle";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { Toaster } from "@/components/ui/sonner";
import { useAuth } from "@/lib/auth-context";
import { useCrm } from "@/lib/crm-store";
import { getSupabase } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

type NavItem = {
  label: string;
  href: string;
  icon: LucideIcon;
};

type NavGroup = {
  label: string;
  items: NavItem[];
};

const NAV_GROUPS: NavGroup[] = [
  {
    label: "Work",
    items: [
      { label: "Dashboard", href: "/", icon: LayoutDashboard },
      { label: "Leads", href: "/leads", icon: Target },
      { label: "Companies", href: "/companies", icon: Building2 },
      { label: "Contacts", href: "/contacts", icon: Users },
      { label: "Pipeline", href: "/pipeline", icon: TrendingUp },
      { label: "Tasks", href: "/tasks", icon: ListTodo },
      { label: "Activities", href: "/activities", icon: Activity },
    ],
  },
  {
    label: "Insights",
    items: [
      { label: "Reports", href: "/reports", icon: BarChart3 },
      { label: "Lead Intelligence", href: "/lead-intelligence", icon: Lightbulb },
    ],
  },
  {
    label: "System",
    items: [{ label: "Settings", href: "/settings", icon: Settings }],
  },
];

const ALL_NAV_ITEMS: NavItem[] = NAV_GROUPS.flatMap((group) => group.items);

const NAV_ITEM_BASE =
  "relative flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm outline-none transition-colors focus-visible:ring-3 focus-visible:ring-ring/50";

function BrandMark({ className }: { className?: string }) {
  return (
    <Image
      src="/brand/emblem-64.png"
      alt=""
      width={32}
      height={32}
      className={cn("size-8 shrink-0 rounded-lg", className)}
    />
  );
}

function SidebarNav({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();

  return (
    <nav aria-label="Main navigation" className="flex flex-1 flex-col gap-4 overflow-y-auto p-3">
      {NAV_GROUPS.map((group) => (
        <div key={group.label} className="flex flex-col gap-1">
          <p className="px-2.5 pb-1 text-[10px] font-medium uppercase tracking-wider text-sidebar-foreground/50">
            {group.label}
          </p>
          {group.items.map(({ label, href, icon: Icon }) => {
            const isActive = pathname === href;
            return (
              <Link
                key={label}
                href={href}
                onClick={onNavigate}
                aria-current={isActive ? "page" : undefined}
                className={cn(
                  NAV_ITEM_BASE,
                  "text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-foreground",
                  isActive &&
                    "bg-sidebar-accent font-medium text-sidebar-foreground shadow-[inset_2px_0_0_0_var(--primary)]",
                )}
              >
                <Icon className="size-4" aria-hidden="true" />
                <span>{label}</span>
              </Link>
            );
          })}
        </div>
      ))}
    </nav>
  );
}

/** Single, persistent reminder that every record is mock data. */
function DemoBadge() {
  return (
    <Badge
      variant="secondary"
      title="Mock data held in browser memory for this session only"
      className="shrink-0 select-none text-xs text-muted-foreground"
    >
      Demo data
    </Badge>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const { live, session } = useAuth();
  const { loading } = useCrm();
  const pageTitle =
    ALL_NAV_ITEMS.find((item) => item.href === pathname)?.label ?? "Fairway CRM";

  // The sign-in page brings its own full-screen layout and needs no CRM chrome
  // (or CRM data) around it.
  if (pathname === "/login") return <>{children}</>;

  // Live mode: hold the shell until the workspace fetch lands, rather than
  // flashing empty states (or, on a failed fetch, whatever is left in state).
  if (live && loading) {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-3 bg-background text-foreground">
        <LoaderCircle
          className="size-5 animate-spin text-muted-foreground"
          aria-hidden="true"
        />
        <p className="text-sm text-muted-foreground">Loading your workspace…</p>
      </div>
    );
  }

  async function handleSignOut() {
    if (signingOut) return;
    setSigningOut(true);
    try {
      const db = getSupabase();
      if (db) await db.auth.signOut();
    } catch (err) {
      console.error("[auth] sign-out failed", err);
    } finally {
      // Navigate rather than reloading: the CRM store is re-keyed per user
      // (see Providers), so nothing stale survives, and the proxy turns this
      // into a redirect to /login now that the cookie is gone. AuthProvider
      // repeats that check client-side in case a navigation slips past it.
      router.replace("/");
    }
  }

  return (
    <div className="flex min-h-dvh flex-col bg-background text-foreground">
      <header className="sticky top-0 z-30 flex h-14 shrink-0 items-center gap-2 border-b border-border bg-background/85 px-3 backdrop-blur sm:px-4">
        <div className="flex items-center gap-2 md:hidden">
          <Sheet open={mobileNavOpen} onOpenChange={setMobileNavOpen}>
            <SheetTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Open navigation menu"
                />
              }
            >
              <Menu className="size-4" aria-hidden="true" />
            </SheetTrigger>
            <SheetContent side="left" className="w-72 gap-0 p-0">
              <SheetHeader className="flex flex-row items-center gap-2.5 border-b border-border p-4">
                <BrandMark />
                <span className="flex flex-col leading-tight">
                  <SheetTitle className="text-sm font-semibold tracking-tight">
                    Fairway CRM
                  </SheetTitle>
                  <SheetDescription className="text-xs">
                    Golf simulator sales
                  </SheetDescription>
                </span>
              </SheetHeader>
              <SidebarNav onNavigate={() => setMobileNavOpen(false)} />
            </SheetContent>
          </Sheet>
          <BrandMark className="size-6" />
          <span className="text-sm font-semibold tracking-tight">
            Fairway CRM
          </span>
        </div>

        <span className="hidden text-sm font-semibold tracking-tight md:inline">
          {pageTitle}
        </span>

        <div className="ml-auto flex items-center gap-2">
          {live ? (
            <>
              <span
                className="hidden max-w-44 truncate text-xs text-muted-foreground sm:inline"
                title={session?.user.email}
              >
                {session?.user.email}
              </span>
              <Button
                variant="outline"
                size="sm"
                onClick={handleSignOut}
                disabled={signingOut}
              >
                {signingOut ? (
                  <LoaderCircle className="animate-spin" aria-hidden="true" />
                ) : (
                  <LogOut aria-hidden="true" />
                )}
                Sign out
              </Button>
            </>
          ) : (
            <DemoBadge />
          )}
          <ThemeToggle />
        </div>
      </header>

      <div className="flex flex-1">
        <aside className="sticky top-14 hidden h-[calc(100dvh-3.5rem)] w-60 shrink-0 flex-col border-r border-sidebar-border bg-sidebar md:flex">
          <div className="flex items-center gap-2.5 p-4">
            <BrandMark />
            <span className="flex flex-col leading-tight">
              <span className="text-sm font-semibold tracking-tight">
                Fairway CRM
              </span>
              <span className="text-[11px] text-muted-foreground">
                Golf simulator sales
              </span>
            </span>
          </div>
          <Separator className="bg-sidebar-border" />
          <SidebarNav />
        </aside>

        <main className="min-w-0 flex-1 px-4 py-6 sm:px-6 lg:px-8">
          <div className="mx-auto w-full max-w-7xl">{children}</div>
        </main>
      </div>
      <Toaster position="bottom-right" richColors closeButton />
    </div>
  );
}
