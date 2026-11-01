"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Monitor, Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { useSyncExternalStore } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PageHeader } from "@/components/layout/page-header";
import { cn } from "@/lib/utils";
import { DEFAULT_NOTIFICATION_PREFS, OWNERS } from "@/lib/types";
import {
  loadPreferences,
  savePreferences,
} from "@/lib/preferences";
import { useAuth } from "@/lib/auth-context";
import { getSupabase, isLiveMode } from "@/lib/supabase/client";
import { useCrm } from "@/lib/crm-store";
import {
  loadNotificationPrefs,
  saveNotificationPrefs,
} from "@/lib/supabase/repository";
import { IntegrationsPanel } from "@/components/crm/integrations-panel";

const TIMEZONES = [
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "America/Monterrey",
  "America/Toronto",
];

const CURRENCIES = ["USD", "CAD", "MXN"];

// Stable identities required by useSyncExternalStore (see theme-toggle.tsx).
const subscribeNoop = () => () => {};
const getIsClient = () => true;
const getIsServer = () => false;

const THEMES = [
  { value: "light", label: "Light", Icon: Sun },
  { value: "dark", label: "Dark", Icon: Moon },
  { value: "system", label: "System", Icon: Monitor },
] as const;

function SaveBar({ onSave }: { onSave: () => void }) {
  return (
    <div className="flex justify-end border-t border-border pt-4">
      <Button onClick={onSave}>Save changes</Button>
    </div>
  );
}

export default function SettingsPage() {
  const mounted = useSyncExternalStore(subscribeNoop, getIsClient, getIsServer);
  const { theme, setTheme } = useTheme();
  const { owners } = useCrm();

  const [profile, setProfile] = useState({
    name: "Alex Rivera",
    email: "alex@fairwaycrm.example",
    timezone: "America/Chicago",
  });

  const [workspace, setWorkspace] = useState({
    name: "Fairway CRM Demo",
    region: "North America",
    fiscalStart: "January",
  });

  const [notifications, setNotifications] = useState(DEFAULT_NOTIFICATION_PREFS);

  const [preferences, setPreferences] = useState({
    defaultOwner: isLiveMode() ? "" : OWNERS[0],
    currency: "USD",
    followUpDays: "3",
  });

  // Load saved preferences after hydration: the prerendered HTML carries the
  // defaults above, so reading localStorage any earlier would mismatch it.
  // Deferred one tick because set-state-in-effect is banned (same pattern as
  // the leads ?lead= deep link).
  useEffect(() => {
    const timer = setTimeout(() => {
      const saved = loadPreferences();
      setPreferences({
        defaultOwner: saved.defaultOwner,
        currency: saved.currency,
        followUpDays: String(saved.followUpDays),
      });
    }, 0);
    return () => clearTimeout(timer);
  }, []);

  // Live mode: hydrate the notification switches from the profiles columns
  // (decision §5.3) after the session exists. Demo mode keeps the shipped
  // defaults and never constructs a client. Deferred one tick, same hydration
  // reason as the preferences load above.
  const { live, session } = useAuth();
  const userId = live ? (session?.user.id ?? null) : null;
  useEffect(() => {
    if (!userId) return;
    const db = getSupabase();
    if (!db) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      loadNotificationPrefs(db, userId)
        .then((prefs) => {
          if (!cancelled) setNotifications(prefs);
        })
        .catch((err) =>
          console.error("[settings] notification prefs load failed", err),
        );
    }, 0);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [userId]);

  function save(label: string) {
    // Nothing here is persisted (no backend yet), so never claim success.
    toast.info(`${label} — demo only. These settings reset when you leave this page.`);
  }

  // Notification preferences persist in live mode (profiles columns,
  // decision §5.3); in demo mode they follow the same demo-only rule as
  // Profile/Workspace because there is no backend to hold them.
  async function saveNotifications() {
    if (live && !userId) {
      // Session still loading — never claim demo-only in a live deployment.
      toast.info("Still signing you in — try again in a moment.");
      return;
    }
    const db = userId ? getSupabase() : null;
    if (!db || !userId) {
      save("Notification preferences");
      return;
    }
    try {
      await saveNotificationPrefs(db, userId, notifications);
      toast.success("Notification preferences saved.");
    } catch (err) {
      console.error("[settings] notification prefs save failed", err);
      toast.error("Could not save notification preferences. Try again.");
    }
  }

  // CRM preferences are the exception: they have real consumers (the add-lead
  // form) so they persist in this browser.
  function saveCrmPreferences() {
    const days = Number(preferences.followUpDays);
    savePreferences({
      defaultOwner: preferences.defaultOwner,
      currency:
        preferences.currency === "CAD" || preferences.currency === "MXN"
          ? preferences.currency
          : "USD",
      followUpDays: Number.isFinite(days)
        ? Math.min(30, Math.max(1, Math.round(days)))
        : 3,
    });
    toast.success("CRM preferences saved in this browser.");
  }

  const themeOptions = THEMES.map(({ value, label, Icon }) => ({
    value,
    label,
    Icon,
  }));
  const activeTheme = mounted ? (theme ?? "system") : null;

  return (
    <div className="space-y-6">
      <PageHeader title="Settings" />

      <Tabs defaultValue="profile" className="space-y-4">
        <TabsList className="max-w-full overflow-x-auto">
          <TabsTrigger value="profile">Profile</TabsTrigger>
          <TabsTrigger value="workspace">Workspace</TabsTrigger>
          <TabsTrigger value="appearance">Appearance</TabsTrigger>
          <TabsTrigger value="notifications">Notifications</TabsTrigger>
          <TabsTrigger value="crm">CRM</TabsTrigger>
          <TabsTrigger value="integrations">Integrations</TabsTrigger>
        </TabsList>

        <TabsContent value="profile">
          <Card>
            <CardHeader>
              <CardTitle>Profile</CardTitle>
            </CardHeader>
            <CardContent className="grid max-w-lg gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="profile-name">Full name</Label>
                <Input
                  id="profile-name"
                  value={profile.name}
                  onChange={(e) =>
                    setProfile((p) => ({ ...p, name: e.target.value }))
                  }
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="profile-email">Email</Label>
                <Input
                  id="profile-email"
                  type="email"
                  value={profile.email}
                  onChange={(e) =>
                    setProfile((p) => ({ ...p, email: e.target.value }))
                  }
                />
              </div>
              <div className="space-y-1.5">
                <Label id="label-tz">Timezone</Label>
                <Select
                  value={profile.timezone}
                  onValueChange={(v) =>
                    setProfile((p) => ({ ...p, timezone: String(v) }))
                  }
                >
                  <SelectTrigger className="w-full" aria-labelledby="label-tz">
                    {profile.timezone}
                  </SelectTrigger>
                  <SelectContent>
                    {TIMEZONES.map((tz) => (
                      <SelectItem key={tz} value={tz}>
                        {tz}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <SaveBar onSave={() => save("Profile")} />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="workspace">
          <Card>
            <CardHeader>
              <CardTitle>Workspace</CardTitle>
            </CardHeader>
            <CardContent className="grid max-w-lg gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="ws-name">Workspace name</Label>
                <Input
                  id="ws-name"
                  value={workspace.name}
                  onChange={(e) =>
                    setWorkspace((w) => ({ ...w, name: e.target.value }))
                  }
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ws-region">Region focus</Label>
                <Input
                  id="ws-region"
                  value={workspace.region}
                  onChange={(e) =>
                    setWorkspace((w) => ({ ...w, region: e.target.value }))
                  }
                />
              </div>
              <div className="space-y-1.5">
                <Label id="label-fiscal">Fiscal year starts</Label>
                <Select
                  value={workspace.fiscalStart}
                  onValueChange={(v) =>
                    setWorkspace((w) => ({ ...w, fiscalStart: String(v) }))
                  }
                >
                  <SelectTrigger className="w-full" aria-labelledby="label-fiscal">
                    {workspace.fiscalStart}
                  </SelectTrigger>
                  <SelectContent>
                    {["January", "April", "July", "October"].map((m) => (
                      <SelectItem key={m} value={m}>
                        {m}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <SaveBar onSave={() => save("Workspace")} />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="appearance">
          <Card>
            <CardHeader>
              <CardTitle>Appearance</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-2">
              {themeOptions.map(({ value, label, Icon }) => (
                <Button
                  key={value}
                  variant={activeTheme === value ? "default" : "outline"}
                  aria-pressed={activeTheme === value}
                  onClick={() => setTheme(value)}
                  className={cn(!mounted && "opacity-50")}
                >
                  <Icon aria-hidden="true" />
                  {label}
                </Button>
              ))}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="notifications">
          <Card>
            <CardHeader>
              <CardTitle>Notifications</CardTitle>
            </CardHeader>
            <CardContent className="grid max-w-lg gap-4">
              {(
                [
                  ["newLeadAlerts", "New lead alerts", "Notify me when a lead is created."],
                  ["dailyDigest", "Daily digest", "One summary email each morning."],
                  ["overdueReminders", "Overdue follow-up reminders", "Alert me when follow-ups pass their date."],
                  ["weeklyReport", "Weekly pipeline report", "Monday snapshot of pipeline value."],
                ] as const
              ).map(([key, label, description]) => (
                <div key={key} className="flex items-center justify-between gap-4">
                  <div>
                    <Label htmlFor={`notif-${key}`}>{label}</Label>
                    <p className="text-xs text-muted-foreground">{description}</p>
                  </div>
                  <Switch
                    id={`notif-${key}`}
                    checked={notifications[key]}
                    onCheckedChange={(checked) =>
                      setNotifications((n) => ({ ...n, [key]: Boolean(checked) }))
                    }
                  />
                </div>
              ))}
              <SaveBar onSave={saveNotifications} />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="crm">
          <Card>
            <CardHeader>
              <CardTitle>CRM preferences</CardTitle>
            </CardHeader>
            <CardContent className="grid max-w-lg gap-4">
              <div className="space-y-1.5">
                <Label id="label-owner">Default lead owner</Label>
                <Select
                  value={preferences.defaultOwner}
                  onValueChange={(v) =>
                    setPreferences((p) => ({ ...p, defaultOwner: String(v) }))
                  }
                >
                  <SelectTrigger className="w-full" aria-labelledby="label-owner">
                    {preferences.defaultOwner}
                  </SelectTrigger>
                  <SelectContent>
                    {owners.length === 0 ? (
                      <SelectItem value="">Unassigned</SelectItem>
                    ) : (
                      owners.map((owner) => (
                        <SelectItem key={owner} value={owner}>
                          {owner}
                        </SelectItem>
                      ))
                    )}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label id="label-currency">Currency</Label>
                <Select
                  value={preferences.currency}
                  onValueChange={(v) =>
                    setPreferences((p) => ({ ...p, currency: String(v) }))
                  }
                >
                  <SelectTrigger className="w-full" aria-labelledby="label-currency">
                    {preferences.currency}
                  </SelectTrigger>
                  <SelectContent>
                    {CURRENCIES.map((c) => (
                      <SelectItem key={c} value={c}>
                        {c}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="crm-days">Default follow-up window (days)</Label>
                <Input
                  id="crm-days"
                  type="number"
                  min={1}
                  max={30}
                  value={preferences.followUpDays}
                  onChange={(e) =>
                    setPreferences((p) => ({ ...p, followUpDays: e.target.value }))
                  }
                />
              </div>
              <SaveBar onSave={saveCrmPreferences} />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="integrations">
          <IntegrationsPanel />
        </TabsContent>
      </Tabs>
    </div>
  );
}
