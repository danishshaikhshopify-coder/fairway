"use client";

import { useEffect, useState, type ReactNode } from "react";
import { motion } from "motion/react";
import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  LoaderCircle,
  LogOut,
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
  Search,
} from "lucide-react";
import { CommandPalette } from "@/components/command-palette";
import { ThemeToggle } from "@/components/theme-toggle";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
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
import { fadeUp, staggerList } from "@/lib/motion";
import { ALL_NAV_ITEMS, NAV_GROUPS } from "@/lib/nav";
import { getSupabase } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

const NAV_ITEM_BASE =
  "relative flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm outline-none transition-colors focus-visible:ring-3 focus-visible:ring-ring/50";

const SIDEBAR_COLLAPSED_KEY = "fairway-crm:sidebar-collapsed";

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

function SidebarNav({
  collapsed,
  onNavigate,
}: {
  collapsed?: boolean;
  onNavigate?: () => void;
}) {
  const pathname = usePathname();

  return (
    <motion.nav
      aria-label="Main navigation"
      className="flex flex-1 flex-col gap-4 overflow-y-auto p-3"
      variants={staggerList}
      initial="hidden"
      animate="show"
    >
      {NAV_GROUPS.map((group) => (
        <div key={group.label} className="flex flex-col gap-1">
          {!collapsed ? (
            <p className="px-2.5 pb-1 text-xs font-medium text-sidebar-foreground/50">
              {group.label}
            </p>
          ) : null}
          {group.items.map(({ label, href, icon: Icon }) => {
            const isActive = pathname === href;
            return (
              <motion.div key={label} variants={fadeUp}>
                <Link
                  href={href}
                  onClick={onNavigate}
                  title={collapsed ? label : undefined}
                  aria-current={isActive ? "page" : undefined}
                  className={cn(
                    NAV_ITEM_BASE,
                    collapsed && "justify-center px-0",
                    "text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-foreground",
                    isActive &&
                      "bg-sidebar-accent font-medium text-sidebar-foreground shadow-[inset_2px_0_0_0_var(--primary)]",
                  )}
                >
                  <Icon className="size-4 shrink-0" aria-hidden="true" />
                  <span className={cn(collapsed && "sr-only")}>{label}</span>
                </Link>
              </motion.div>
            );
          })}
        </div>
      ))}
    </motion.nav>
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
  const [collapsed, setCollapsed] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const { live, session } = useAuth();
  const { loading } = useCrm();
  const pageTitle =
    ALL_NAV_ITEMS.find((item) => item.href === pathname)?.label ?? "Fairway CRM";

  // Restore the collapsed-sidebar preference after hydration (deferred one
  // tick, same reason as the other localStorage reads in this codebase —
  // the prerendered HTML has to match the first client render).
  useEffect(() => {
    const timer = setTimeout(() => {
      if (window.localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === "1") {
        setCollapsed(true);
      }
    }, 0);
    return () => clearTimeout(timer);
  }, []);

  function toggleCollapsed() {
    setCollapsed((prev) => {
      const next = !prev;
      window.localStorage.setItem(SIDEBAR_COLLAPSED_KEY, next ? "1" : "0");
      return next;
    });
  }

  // Cmd/Ctrl+K opens the command palette from anywhere in the app.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setPaletteOpen((open) => !open);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  // The sign-in and invite-acceptance pages bring their own full-screen
  // layout and need no CRM chrome (or CRM data) around them. The latter is
  // visited signed-out, mid-invite, before any workspace fetch could work.
  if (pathname === "/login" || pathname === "/invite/accept") return <>{children}</>;

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
      <header className="glass-surface sticky top-0 z-30 flex h-14 shrink-0 items-center gap-2 border-b border-border px-3 sm:px-4">
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

        <Button
          variant="outline"
          size="sm"
          onClick={() => setPaletteOpen(true)}
          className="ml-2 hidden items-center gap-2 text-muted-foreground sm:inline-flex"
        >
          <Search className="size-3.5" aria-hidden="true" />
          Search
          <Kbd className="ml-1">⌘K</Kbd>
        </Button>

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
        <aside
          className={cn(
            "glass-surface sticky top-14 hidden h-[calc(100dvh-3.5rem)] shrink-0 flex-col border-r border-sidebar-border transition-[width] duration-200 ease-[cubic-bezier(0.16,1,0.3,1)] md:flex",
            collapsed ? "w-16" : "w-60",
          )}
        >
          <div
            className={cn(
              "flex items-center gap-2.5 p-4",
              collapsed && "justify-center px-2",
            )}
          >
            <BrandMark />
            {!collapsed ? (
              <span className="flex min-w-0 flex-col leading-tight">
                <span className="truncate text-sm font-semibold tracking-tight">
                  Fairway CRM
                </span>
                <span className="truncate text-[11px] text-muted-foreground">
                  Golf simulator sales
                </span>
              </span>
            ) : null}
          </div>
          <Separator className="bg-sidebar-border" />
          <SidebarNav collapsed={collapsed} />
          <Separator className="bg-sidebar-border" />
          <div className={cn("p-2", collapsed && "flex justify-center")}>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={toggleCollapsed}
              aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
              className="text-sidebar-foreground/70 hover:text-sidebar-foreground"
            >
              {collapsed ? (
                <PanelLeftOpen className="size-4" aria-hidden="true" />
              ) : (
                <PanelLeftClose className="size-4" aria-hidden="true" />
              )}
            </Button>
          </div>
        </aside>

        <main className="min-w-0 flex-1 px-4 py-6 sm:px-6 lg:px-8">
          <div key={pathname} className="page-enter mx-auto w-full max-w-7xl">
            {children}
          </div>
        </main>
      </div>
      <Toaster position="bottom-right" richColors closeButton />
      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />
    </div>
  );
}
