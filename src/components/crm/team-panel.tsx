"use client";

// Settings -> Team. Private, invite-only access: only the workspace owner
// can invite, change a role, deactivate, or pick who gets reminder emails
// (see canManageTeam() and the /api/team/* routes). A non-owner sees the
// roster read-only — the invite form and every row control come from
// whether GET /api/team/invitations succeeds (owner-only), not a client
// guess at the current user's role.

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Mail, RotateCw, Trash2, UserCheck, UserX, Users } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { ConfirmDialog } from "@/components/crm/confirm-dialog";
import { EmptyState } from "@/components/crm/empty-state";
import { KpiCard } from "@/components/crm/kpi-card";
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
  removed: boolean;
  removedAt: string | null;
  banned: boolean;
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

class ApiError extends Error {
  code?: string;
  constructor(message: string, code?: string) {
    super(message);
    this.code = code;
  }
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: { "content-type": "application/json", ...init?.headers },
  });
  const body = (await response.json().catch(() => ({}))) as T & { error?: string; message?: string };
  if (!response.ok) {
    throw new ApiError(body?.message || body?.error || `Request failed (${response.status}).`, body?.error);
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
  const [deleteTarget, setDeleteTarget] = useState<Member | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [reinviteRoles, setReinviteRoles] = useState<Record<string, InvitableRole>>({});
  const [reinvitingId, setReinvitingId] = useState<string | null>(null);
  const [resendingId, setResendingId] = useState<string | null>(null);
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  // shortcut: a fixed 60s cooldown, not the provider's real reset time — good
  // enough to stop hammering the shared 2/hour Supabase email quota.
  const [resendCooldown, setResendCooldown] = useState<Record<string, boolean>>({});

  async function load() {
    setLoading(true);
    try {
      const membersData = await api<{ members: Member[] }>("/api/team/members");
      setMembers(membersData.members);
      setLoadError(null);
      try {
        const invitesData = await api<{ invitations: Invitation[] }>("/api/team/invitations");
        setInvitations(invitesData.invitations.filter((i) => i.status === "pending"));
        setIsOwner(true);
      } catch {
        setIsOwner(false);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not load the team.";
      toast.error(message);
      setLoadError(message);
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
    setRevokingId(id);
    try {
      await api("/api/team/invitations/revoke", { method: "POST", body: JSON.stringify({ id }) });
      toast.success(`Revoked the invite for ${email}.`);
      load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not revoke the invite.");
    } finally {
      setRevokingId(null);
    }
  }

  async function resendInvite(id: string, email: string) {
    setResendingId(id);
    try {
      await api("/api/team/invitations/resend", { method: "POST", body: JSON.stringify({ id }) });
      toast.success(`Resent the invite to ${email}.`);
    } catch (error) {
      if (error instanceof ApiError && error.code === "rate_limited") {
        toast.error(
          "Too many emails sent recently — Supabase limits this project to a few per hour. Try again shortly.",
        );
        setResendCooldown((prev) => ({ ...prev, [id]: true }));
        setTimeout(() => setResendCooldown((prev) => ({ ...prev, [id]: false })), 60_000);
      } else {
        toast.error(error instanceof Error ? error.message : "Could not resend the invite.");
      }
    } finally {
      setResendingId(null);
    }
  }

  async function confirmDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await api("/api/team/members/delete", {
        method: "POST",
        body: JSON.stringify({ id: deleteTarget.id, confirm: true }),
      });
      toast.success(`Permanently deleted ${deleteTarget.fullName || deleteTarget.email || "that member"}.`);
      load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not delete that member.");
    } finally {
      setDeleting(false);
      setDeleteTarget(null);
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

  async function reinvite(member: Member) {
    const role = reinviteRoles[member.id] ?? "sales_rep";
    setReinvitingId(member.id);
    try {
      await api("/api/team/invitations", {
        method: "POST",
        body: JSON.stringify({ email: member.email, role }),
      });
      toast.success(`Sent a new invitation to ${member.email}.`);
      load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not re-invite that person.");
    } finally {
      setReinvitingId(null);
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

  const activeMembers = members.filter((m) => !m.removed);
  const removedMembers = members.filter((m) => m.removed);

  return (
    <div className="space-y-6">
      {loadError ? <p className="text-sm text-destructive">{loadError}</p> : null}

      {isOwner ? (
        <section aria-label="Team overview">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <KpiCard label="Active" value={activeMembers.length} icon={Users} />
            <KpiCard label="Pending" value={invitations.length} icon={Mail} />
            <KpiCard label="Removed" value={removedMembers.length} icon={UserX} />
          </div>
        </section>
      ) : null}

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
          </CardContent>
        </Card>
      ) : null}

      {isOwner ? (
        <Card>
          <CardHeader>
            <CardTitle>Pending invitations</CardTitle>
          </CardHeader>
          <CardContent>
            {loading ? (
              <p className="py-8 text-center text-sm text-muted-foreground">Loading invitations…</p>
            ) : invitations.length > 0 ? (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Email</TableHead>
                    <TableHead>Role</TableHead>
                    <TableHead>Invitation date</TableHead>
                    <TableHead>Status</TableHead>
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
                        <Badge variant="outline">Pending</Badge>
                      </TableCell>
                      <TableCell className="space-x-1 text-right">
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={resendingId === inv.id || resendCooldown[inv.id]}
                          onClick={() => resendInvite(inv.id, inv.email)}
                        >
                          <RotateCw className="size-4" aria-hidden="true" />
                          Resend
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={revokingId === inv.id}
                          onClick={() => revokeInvite(inv.id, inv.email)}
                        >
                          <Trash2 className="size-4" aria-hidden="true" />
                          Cancel
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            ) : (
              <EmptyState icon={Mail} title="No pending invitations" />
            )}
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Active members</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Member</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Reminder emails</TableHead>
                <TableHead>Gmail</TableHead>
                {isOwner ? <TableHead>Actions</TableHead> : null}
              </TableRow>
            </TableHeader>
            <TableBody>
              {activeMembers.map((m) => (
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
              {loading ? (
                <TableRow>
                  <TableCell colSpan={isOwner ? 7 : 6} className="text-center text-sm text-muted-foreground">
                    Loading members…
                  </TableCell>
                </TableRow>
              ) : !loadError && activeMembers.length === 0 ? (
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

      {isOwner ? (
        <Card>
          <CardHeader>
            <CardTitle>Removed members</CardTitle>
          </CardHeader>
          <CardContent>
            {loading ? (
              <p className="py-8 text-center text-sm text-muted-foreground">Loading removed members…</p>
            ) : removedMembers.length > 0 ? (
              <>
                <p className="mb-4 text-xs text-muted-foreground">
                  Removed access, but past leads, tasks and activities are kept. Re-inviting sends
                  a fresh sign-in link — their old password no longer works, and you choose their
                  role again; it is never restored automatically.
                </p>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Member</TableHead>
                      <TableHead>Email</TableHead>
                      <TableHead>Previous role</TableHead>
                      <TableHead>Removed</TableHead>
                      <TableHead>New role</TableHead>
                      <TableHead />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {removedMembers.map((m) => {
                      const pending = invitations.some(
                        (inv) => inv.email.toLowerCase() === (m.email ?? "").toLowerCase(),
                      );
                      return (
                        <TableRow key={m.id}>
                          <TableCell>{m.fullName || "—"}</TableCell>
                          <TableCell>{m.email ?? "—"}</TableCell>
                          <TableCell>
                            <Badge variant="outline">
                              {ROLES.find((r) => r.value === m.role)?.label ?? m.role}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-sm text-muted-foreground">
                            {m.removedAt ? new Date(m.removedAt).toLocaleDateString() : "—"}
                          </TableCell>
                          <TableCell>
                            <Select
                              value={reinviteRoles[m.id] ?? "sales_rep"}
                              onValueChange={(v) =>
                                setReinviteRoles((prev) => ({ ...prev, [m.id]: v as InvitableRole }))
                              }
                            >
                              <SelectTrigger className="w-36">
                                {
                                  ROLES.find((r) => r.value === (reinviteRoles[m.id] ?? "sales_rep"))
                                    ?.label
                                }
                              </SelectTrigger>
                              <SelectContent>
                                {ROLES.map((r) => (
                                  <SelectItem key={r.value} value={r.value}>
                                    {r.label}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center gap-1">
                              {pending ? (
                                <span className="text-sm text-muted-foreground">Invitation sent</span>
                              ) : (
                                <Button
                                  variant="outline"
                                  size="sm"
                                  disabled={reinvitingId === m.id}
                                  onClick={() => reinvite(m)}
                                >
                                  <Mail className="size-4" aria-hidden="true" />
                                  Re-invite
                                </Button>
                              )}
                              <Button
                                variant="ghost"
                                size="sm"
                                className="text-destructive hover:text-destructive"
                                onClick={() => setDeleteTarget(m)}
                              >
                                <Trash2 className="size-4" aria-hidden="true" />
                                Delete permanently
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </>
            ) : (
              <EmptyState icon={UserCheck} title="No removed members" />
            )}
          </CardContent>
        </Card>
      ) : null}

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

      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open && !deleting) setDeleteTarget(null);
        }}
        title="Delete this member permanently?"
        description={
          deleteTarget
            ? `This permanently deletes ${deleteTarget.fullName || deleteTarget.email || "this member"}'s account access and team membership — this cannot be undone. Their historical leads, tasks, activities and companies are kept, just no longer attributed to them as a user.`
            : ""
        }
        confirmLabel="Delete permanently"
        onConfirm={confirmDelete}
      />
    </div>
  );
}
