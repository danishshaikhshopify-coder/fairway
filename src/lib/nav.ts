import type { LucideIcon } from "lucide-react";
import {
  Activity,
  BarChart3,
  Building2,
  LayoutDashboard,
  Lightbulb,
  ListTodo,
  Settings,
  Target,
  TrendingUp,
  Users,
} from "lucide-react";

export type NavItem = {
  label: string;
  href: string;
  icon: LucideIcon;
};

export type NavGroup = {
  label: string;
  items: NavItem[];
};

// Shared between the sidebar and the command palette, so the two never list
// different pages.
export const NAV_GROUPS: NavGroup[] = [
  {
    label: "Pipeline",
    items: [
      { label: "Dashboard", href: "/", icon: LayoutDashboard },
      { label: "Pipeline", href: "/pipeline", icon: TrendingUp },
      { label: "Leads", href: "/leads", icon: Target },
    ],
  },
  {
    label: "Relationships",
    items: [
      { label: "Companies", href: "/companies", icon: Building2 },
      { label: "Contacts", href: "/contacts", icon: Users },
    ],
  },
  {
    label: "Workspace",
    items: [
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

export const ALL_NAV_ITEMS: NavItem[] = NAV_GROUPS.flatMap((group) => group.items);
