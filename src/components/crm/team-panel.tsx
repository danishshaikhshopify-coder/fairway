"use client";

// Settings -> Team. Private, invite-only access: only the workspace owner
// can invite, change a role, deactivate, or pick who gets reminder emails
// (see canManageTeam() and the /api/team/* routes). A non-owner sees the
// roster read-only — the invite form and every row control come from
// whether GET /api/team/invitations succeeds (owner-only), not a client
// guess at the current user's role.

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Mail, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { ConfirmDialog } from "@/components/crm/confirm-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { isLiveMode } from "@/lib/supabase/client";
import type { InvitableRole } from "@/lib/team/invites";

const ROLES: { value: InvitableRole; label: string }[] = [
  { value: "admin", label: "Admin" },
  { value: "sales_rep", label: "Sales rep" },
  { value: "viewer", label: "Viewer" },
];

interface Member {
  id: string;
  email: string | null;
  fullName: string;
  role: string;
  isActive: boolean;
  receivesReminders: boolean;
  gmailConnected: boolean;
  gmailEmail: string | null;
}

interface Invitation {
  id: string;
  email: string;
  role: string;
  status: string;
  created_at: string;
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: { "content-type": "application/json", ...init?.headers },
  });
  const body = (await response.json().catch(() => ({}))) as T & { error?: string; message?: string };
  if (!response.ok) {
    throw new Error(body?.message || body?.error || `Request failed (${response.status}).`);
  }
  return body;
}

export function TeamPanel() {
  const live = isLiveMode();
  const [isOwner, setIsOwner] = useState(false);
  const [loading, setLoading] = useState(live);
  const [members, setMembers] = useState<Member[]>([]);
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<InvitableRole>("sales_rep");
  const [inviting, setInviting] = useState(false);
  const [removeTarget, setRemoveTarget] = useState<Member | null>(null);
  const [removing, setRemoving] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const membersData = await api<{ members: Member[] }>("/api/team/members");
      setMembers(membersData.members);
      try {
        const invitesData = await api<{ invitations: Invitation[] }>("/api/team/invitations");
        setInvitations(invitesData.invitations.filter((i) => i.status === "pending"));
        setIsOwner(true);
      } catch {
        setIsOwner(false);
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not load the team.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!live) return;
    const timer = setTimeout(load, 0);
    return () => clearTimeout(timer);
  }, [live]);

  async function sendInvite() {
    setInviting(true);
    try {
      await api("/api/team/invitations", {
        method: "POST",
        body: JSON.stringify({ email: inviteEmail, role: inviteRole }),
      });
      toast.success(`Invited ${inviteEmail}.`);
      setInviteEmail("");
      load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not send the invite.");
    } finally {
      setInviting(false);
    }
  }

  async function revokeInvite(id: string, email: string) {
    try {
      await api("/api/team/invitations/revoke", { method: "POST", body: JSON.stringify({ id }) });
      toast.success(`Revoked the invite for ${email}.`);
      load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not revoke the invite.");
    }
  }

  async function patchMember(id: string, patch: Record<string, unknown>) {
    try {
      await api("/api/team/members", { method: "POST", body: JSON.stringify({ id, ...patch }) });
      load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not update that member.");
    }
  }

  async function confirmRemove() {
    if (!removeTarget) return;
    setRemoving(true);
    try {
      await api("/api/team/members/remove", {
        method: "POST",
        body: JSON.stringify({ id: removeTarget.id }),
      });
      toast.success(`Removed ${removeTarget.fullName || removeTarget.email || "that member"}.`);
      load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not remove that member.");
    } finally {
      setRemoving(false);
      setRemoveTarget(null);
    }
  }

  if (!live) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Team</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Connect to live mode (Supabase configured) to manage team access.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {isOwner ? (
        <Card>
          <CardHeader>
            <CardTitle>Invite a partner</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-xs text-muted-foreground">
              Signup is invite-only. An invited email gets a sign-in link from Supabase; no one
              else can create an account, and partners cannot invite anyone themselves.
            </p>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
              <div className="flex-1 space-y-1.5">
                <Label htmlFor="invite-email">Email</Label>
                <Input
                  id="invite-email"
                  type="email"
                  placeholder="partner@company.com"
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                />
              </div>
              <div className="w-full space-y-1.5 sm:w-40">
                <Label>Role</Label>
                <Select value={inviteRole} onValueChange={(v) => setInviteRole(v as InvitableRole)}>
                  <SelectTrigger className="w-full">
                    {ROLES.find((r) => r.value === inviteRole)?.label}
                  </SelectTrigger>
                  <SelectContent>
                    {ROLES.map((r) => (
                      <SelectItem key={r.value} value={r.value}>
                        {r.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Button onClick={sendInvite} disabled={inviting || !inviteEmail.trim()}>
                <Mail className="size-4" aria-hidden="true" />
                Send invite
              </Button>
            </div>

            {invitations.length > 0 ? (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Email</TableHead>
                    <TableHead>Role</TableHead>
                    <TableHead>Sent</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {invitations.map((inv) => (
                    <TableRow key={inv.id}>
                      <TableCell>{inv.email}</TableCell>
                      <TableCell>{ROLES.find((r) => r.value === inv.role)?.label ?? inv.role}</TableCell>
                      <TableCell>{new Date(inv.created_at).toLocaleDateString()}</TableCell>
                      <TableCell>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => revokeInvite(inv.id, inv.email)}
                        >
                          <Trash2 className="size-4" aria-hidden="true" />
                          Revoke
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Members</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Active</TableHead>
                <TableHead>Reminder emails</TableHead>
                <TableHead>Gmail</TableHead>
                {isOwner ? <TableHead /> : null}
              </TableRow>
            </TableHeader>
            <TableBody>
              {members.map((m) => (
                <TableRow key={m.id}>
                  <TableCell>{m.fullName || "—"}</TableCell>
                  <TableCell>{m.email ?? "—"}</TableCell>
                  <TableCell>
                    {isOwner && m.role !== "owner" ? (
                      <Select
                        value={m.role}
                        onValueChange={(v) => patchMember(m.id, { role: v })}
                      >
                        <SelectTrigger className="w-36">
                          {ROLES.find((r) => r.value === m.role)?.label ?? m.role}
                        </SelectTrigger>
                        <SelectContent>
                          {ROLES.map((r) => (
                            <SelectItem key={r.value} value={r.value}>
                              {r.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    ) : (
                      <Badge variant={m.role === "owner" ? "default" : "outline"}>
                        {m.role === "owner" ? "Owner" : ROLES.find((r) => r.value === m.role)?.label ?? m.role}
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell>
                    {m.role === "owner" ? (
                      <Badge>Active</Badge>
                    ) : isOwner ? (
                      <Switch
                        checked={m.isActive}
                        onCheckedChange={(checked) => patchMember(m.id, { isActive: checked })}
                      />
                    ) : (
                      <Badge variant={m.isActive ? "default" : "outline"}>
                        {m.isActive ? "Active" : "Deactivated"}
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell>
                    {isOwner && m.role !== "owner" ? (
                      <Checkbox
                        checked={m.receivesReminders}
                        onCheckedChange={(checked) =>
                          patchMember(m.id, { receivesReminders: checked === true })
                        }
                        disabled={!m.gmailConnected}
                        aria-label="Receives reminder emails"
                      />
                    ) : (
                      <span className="text-sm text-muted-foreground">
                        {m.receivesReminders ? "Yes" : "No"}
                      </span>
                    )}
                  </TableCell>
                  <TableCell>
                    {m.gmailConnected ? (
                      <span className="text-sm">{m.gmailEmail}</span>
                    ) : (
                      <span className="text-sm text-muted-foreground">Not connected</span>
                    )}
                  </TableCell>
                  {isOwner ? (
                    <TableCell>
                      {m.role !== "owner" ? (
                        <Button variant="ghost" size="sm" onClick={() => setRemoveTarget(m)}>
                          <Trash2 className="size-4" aria-hidden="true" />
                          Remove
                        </Button>
                      ) : null}
                    </TableCell>
                  ) : null}
                </TableRow>
              ))}
              {!loading && members.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={isOwner ? 7 : 6} className="text-center text-sm text-muted-foreground">
                    No members yet.
                  </TableCell>
                </TableRow>
              ) : null}
            </TableBody>
          </Table>
          {isOwner ? (
            <p className="mt-3 text-xs text-muted-foreground">
              A partner needs their own connected Gmail before reminder emails can reach them —
              that is where the email is delivered.
            </p>
          ) : null}
        </CardContent>
      </Card>

      <ConfirmDialog
        open={removeTarget !== null}
        onOpenChange={(open) => {
          if (!open && !removing) setRemoveTarget(null);
        }}
        title="Remove this member?"
        description={
          removeTarget
            ? `${removeTarget.fullName || "This member"} (${removeTarget.email ?? "no email"}) will immediately lose CRM access. Their past leads, tasks and activities are kept.`
            : ""
        }
        confirmLabel="Remove"
        onConfirm={confirmRemove}
      />
    </div>
  );
}
