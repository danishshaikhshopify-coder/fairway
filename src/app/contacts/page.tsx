"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Link2, Mail, Phone, Plus, RotateCcw, User } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Separator } from "@/components/ui/separator";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { FormField } from "@/components/crm/form-field";
import { ConfirmDialog } from "@/components/crm/confirm-dialog";
import { EmptyState } from "@/components/crm/empty-state";
import { LeadStatusBadge } from "@/components/crm/status-badge";
import { PageHeader } from "@/components/layout/page-header";
import { useCrm } from "@/lib/crm-store";
import { isLiveMode } from "@/lib/supabase/client";
import { formatFullCurrency } from "@/lib/format";
import { OWNERS, type Contact } from "@/lib/types";

const ALL = "all";

/** Social URLs are free text, so only add a scheme when the user did not. */
function websiteHref(url: string): string {
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(url) ? url : `https://${url}`;
}

const emptyContactForm = {
  name: "",
  company: "",
  title: "",
  email: "",
  phone: "",
  owner: isLiveMode() ? "" : OWNERS[0],
  linkedinUrl: "",
  instagramUrl: "",
  facebookUrl: "",
};

type ContactForm = typeof emptyContactForm;

function validateContactForm(form: ContactForm): Record<string, string> {
  const errors: Record<string, string> = {};
  if (!form.name.trim()) errors.name = "Name is required.";
  if (!form.company) errors.company = "Pick a company.";
  if (!form.title.trim()) errors.title = "Job title is required.";
  if (!form.email.trim()) {
    errors.email = "Email is required.";
  } else if (!/^\S+@\S+\.\S+$/.test(form.email.trim())) {
    errors.email = "Enter a valid email address.";
  }
  return errors;
}

export default function ContactsPage() {
  const { contacts, companies, leads, owners, addContact, updateContact, updateLead, removeContact } =
    useCrm();

  const [search, setSearch] = useState("");
  const [companyFilter, setCompanyFilter] = useState<string>(ALL);
  const [sort, setSort] = useState<string>("name");
  const [page, setPage] = useState(1);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Contact | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);

  const [addOpen, setAddOpen] = useState(false);
  const [form, setForm] = useState<ContactForm>({
    ...emptyContactForm,
    company: companies[0]?.name ?? "",
  });
  const [errors, setErrors] = useState<Record<string, string>>({});

  const companyNames = useMemo(
    () => companies.map((c) => c.name).sort((a, b) => a.localeCompare(b)),
    [companies],
  );

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return contacts.filter((contact) => {
      if (companyFilter !== ALL && contact.company !== companyFilter) return false;
      if (!query) return true;
      return (
        contact.name.toLowerCase().includes(query) ||
        contact.email.toLowerCase().includes(query) ||
        contact.phone.toLowerCase().includes(query) ||
        contact.company.toLowerCase().includes(query)
      );
    });
  }, [contacts, search, companyFilter]);

  const sorted = useMemo(() => {
    const rows = [...filtered];
    switch (sort) {
      case "company":
        rows.sort((a, b) => a.company.localeCompare(b.company));
        break;
      case "title":
        rows.sort((a, b) => a.title.localeCompare(b.title));
        break;
      default:
        rows.sort((a, b) => a.name.localeCompare(b.name));
    }
    return rows;
  }, [filtered, sort]);

  const PAGE_SIZE = 8;
  const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const pageRows = sorted.slice(
    (currentPage - 1) * PAGE_SIZE,
    currentPage * PAGE_SIZE,
  );

  const detailContact = contacts.find((c) => c.id === detailId) ?? null;
  const detailLeads = detailContact
    ? leads.filter((l) => l.contact === detailContact.name)
    : [];

  const filtersActive = search.trim() !== "" || companyFilter !== ALL;

  function resetFilters() {
    setSearch("");
    setCompanyFilter(ALL);
    setPage(1);
  }

  function setField<K extends keyof ContactForm>(key: K, value: ContactForm[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
    setErrors((prev) => {
      if (!(key in prev)) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });
  }

  function confirmDelete() {
    if (!deleteTarget) return;
    removeContact(deleteTarget.id);
    if (detailId === deleteTarget.id) setDetailId(null);
    setDeleteTarget(null);
    toast.success(`Contact deleted: ${deleteTarget.name}.`);
  }

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (companyNames.length === 0) {
      setErrors({ company: "Add a company first." });
      toast.error("Add a company before creating contacts.");
      return;
    }
    const nextErrors = validateContactForm(form);
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) {
      toast.error("Fix the highlighted fields before adding the contact.");
      return;
    }
    const existingEmail = contacts.find(
      (c) =>
        c.id !== editingId &&
        c.email.trim().toLowerCase() === form.email.trim().toLowerCase(),
    );
    if (existingEmail) {
      setErrors({ email: "A contact with this email already exists." });
      toast.error(
        `A contact with this email already exists (${existingEmail.name}).`,
      );
      return;
    }
    const contact: Omit<Contact, "id"> = {
      name: form.name.trim(),
      company: form.company,
      title: form.title.trim(),
      email: form.email.trim(),
      phone: form.phone.trim(),
      owner: form.owner,
      linkedinUrl: form.linkedinUrl.trim(),
      instagramUrl: form.instagramUrl.trim(),
      facebookUrl: form.facebookUrl.trim(),
    };
    if (editingId) {
      const previous = contacts.find((c) => c.id === editingId);
      updateContact(editingId, contact);
      // Leads join on the contact NAME string (the DB uses FKs); propagate a
      // rename so the lead's contact link stays intact.
      if (previous && previous.name !== contact.name) {
        leads
          .filter((l) => l.contact === previous.name)
          .forEach((l) => updateLead(l.id, { contact: contact.name }));
      }
      setForm({ ...emptyContactForm, company: companies[0]?.name ?? "" });
      setErrors({});
      setAddOpen(false);
      setEditingId(null);
      toast.success(`${contact.name} updated.`);
      return;
    }
    addContact(contact);
    setForm({ ...emptyContactForm, company: companies[0]?.name ?? "" });
    setErrors({});
    setAddOpen(false);
    setPage(1);
    toast.success(`${contact.name} added.`);
  }

  function openEdit(contact: Contact) {
    setForm({
      name: contact.name,
      company: contact.company,
      title: contact.title,
      email: contact.email,
      phone: contact.phone,
      owner: contact.owner,
      linkedinUrl: contact.linkedinUrl,
      instagramUrl: contact.instagramUrl,
      facebookUrl: contact.facebookUrl,
    });
    setErrors({});
    setEditingId(contact.id);
    setAddOpen(true);
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Contacts"
        actions={
          <Button onClick={() => setAddOpen(true)}>
            <Plus aria-hidden="true" />
            Add contact
          </Button>
        }
      />

      <Card>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            <div className="min-w-48 flex-1">
              <Input
                aria-label="Search contacts"
                placeholder="Search name, email, phone or company…"
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setPage(1);
                }}
              />
            </div>
            <Select
              value={companyFilter}
              onValueChange={(v) => {
                setCompanyFilter(String(v));
                setPage(1);
              }}
            >
              <SelectTrigger className="w-56" aria-label="Filter by company">
                {companyFilter === ALL ? "All companies" : companyFilter}
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All companies</SelectItem>
                {companyNames.map((name) => (
                  <SelectItem key={name} value={name}>
                    {name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select
              value={sort}
              onValueChange={(v) => {
                setSort(String(v));
                setPage(1);
              }}
            >
              <SelectTrigger className="w-44" aria-label="Sort contacts">
                {sort === "company"
                  ? "Company (A–Z)"
                  : sort === "title"
                    ? "Job title (A–Z)"
                    : "Name (A–Z)"}
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="name">Name (A–Z)</SelectItem>
                <SelectItem value="company">Company (A–Z)</SelectItem>
                <SelectItem value="title">Job title (A–Z)</SelectItem>
              </SelectContent>
            </Select>
            {filtersActive ? (
              <Button variant="ghost" onClick={resetFilters}>
                <RotateCcw aria-hidden="true" />
                Clear
              </Button>
            ) : null}
          </div>

          {filtered.length === 0 ? (
            <EmptyState
              title={
                filtersActive ? "No contacts match your filters" : "No contacts yet"
              }
              description={
                filtersActive
                  ? "Try clearing the search or filter, or add a new contact."
                  : "Add a contact to connect people to their companies and leads."
              }
              action={
                filtersActive ? (
                  <Button variant="outline" onClick={resetFilters}>
                    Clear filters
                  </Button>
                ) : (
                  <Button onClick={() => setAddOpen(true)}>
                    <Plus aria-hidden="true" />
                    Add contact
                  </Button>
                )
              }
            />
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Company</TableHead>
                    <TableHead className="hidden lg:table-cell">Title</TableHead>
                    <TableHead>Email</TableHead>
                    <TableHead className="hidden md:table-cell">Phone</TableHead>
                    <TableHead className="hidden xl:table-cell">Owner</TableHead>
                    <TableHead className="w-20" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {pageRows.map((contact) => (
                    <TableRow key={contact.id}>
                      <TableCell className="font-medium">{contact.name}</TableCell>
                      <TableCell className="text-sm">{contact.company}</TableCell>
                      <TableCell className="hidden text-sm text-muted-foreground lg:table-cell">
                        {contact.title}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {contact.email}
                      </TableCell>
                      <TableCell className="hidden text-sm whitespace-nowrap text-muted-foreground md:table-cell">
                        {contact.phone || "—"}
                      </TableCell>
                      <TableCell className="hidden text-sm text-muted-foreground xl:table-cell">
                        {contact.owner}
                      </TableCell>
                      <TableCell>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setDetailId(contact.id)}
                        >
                          View
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm text-muted-foreground">
              {sorted.length} of {contacts.length} contacts
            </p>
            {totalPages > 1 ? (
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={currentPage <= 1}
                  onClick={() => setPage(currentPage - 1)}
                >
                  Previous
                </Button>
                <span className="text-sm text-muted-foreground tabular-nums">
                  Page {currentPage} of {totalPages}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={currentPage >= totalPages}
                  onClick={() => setPage(currentPage + 1)}
                >
                  Next
                </Button>
              </div>
            ) : null}
          </div>
        </CardContent>
      </Card>

      <Sheet
        open={detailId !== null}
        onOpenChange={(open) => {
          if (!open) setDetailId(null);
        }}
      >
        <SheetContent className="w-full gap-0 overflow-y-auto sm:max-w-md">
          {detailContact ? (
            <>
              <SheetHeader className="border-b border-border p-4">
                <SheetTitle className="text-base">{detailContact.name}</SheetTitle>
                <SheetDescription>
                  {detailContact.title} at {detailContact.company}
                </SheetDescription>
                <div className="flex gap-2 pt-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => openEdit(detailContact)}
                  >
                    Edit
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setDeleteTarget(detailContact)}
                  >
                    Delete contact
                  </Button>
                </div>
              </SheetHeader>
              <div className="space-y-5 p-4">
                <div className="space-y-3">
                  <div className="flex items-start gap-3 text-sm">
                    <User className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                    <div>
                      <p className="text-xs text-muted-foreground">Owner</p>
                      <p>{detailContact.owner}</p>
                    </div>
                  </div>
                  <div className="flex items-start gap-3 text-sm">
                    <Mail className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                    <div className="min-w-0">
                      <p className="text-xs text-muted-foreground">Email</p>
                      <a
                        href={`mailto:${detailContact.email}`}
                        className="break-all text-primary underline-offset-4 hover:underline"
                      >
                        {detailContact.email}
                      </a>
                    </div>
                  </div>
                  <div className="flex items-start gap-3 text-sm">
                    <Phone className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                    <div>
                      <p className="text-xs text-muted-foreground">Phone</p>
                      <p>{detailContact.phone || "No phone on file"}</p>
                    </div>
                  </div>
                  {detailContact.linkedinUrl ? (
                    <div className="flex items-start gap-3 text-sm">
                      <Link2 className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                      <div className="min-w-0">
                        <p className="text-xs text-muted-foreground">LinkedIn</p>
                        <a
                          href={websiteHref(detailContact.linkedinUrl)}
                          target="_blank"
                          rel="noreferrer"
                          className="break-words text-primary underline-offset-4 hover:underline"
                        >
                          {detailContact.linkedinUrl}
                        </a>
                      </div>
                    </div>
                  ) : null}
                  {detailContact.instagramUrl ? (
                    <div className="flex items-start gap-3 text-sm">
                      <Link2 className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                      <div className="min-w-0">
                        <p className="text-xs text-muted-foreground">Instagram</p>
                        <a
                          href={websiteHref(detailContact.instagramUrl)}
                          target="_blank"
                          rel="noreferrer"
                          className="break-words text-primary underline-offset-4 hover:underline"
                        >
                          {detailContact.instagramUrl}
                        </a>
                      </div>
                    </div>
                  ) : null}
                  {detailContact.facebookUrl ? (
                    <div className="flex items-start gap-3 text-sm">
                      <Link2 className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                      <div className="min-w-0">
                        <p className="text-xs text-muted-foreground">Facebook</p>
                        <a
                          href={websiteHref(detailContact.facebookUrl)}
                          target="_blank"
                          rel="noreferrer"
                          className="break-words text-primary underline-offset-4 hover:underline"
                        >
                          {detailContact.facebookUrl}
                        </a>
                      </div>
                    </div>
                  ) : null}
                </div>

                <Separator />

                <div className="space-y-2">
                  <p className="text-sm font-medium">
                    Related leads ({detailLeads.length})
                  </p>
                  {detailLeads.length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                      No leads reference this contact yet.
                    </p>
                  ) : (
                    detailLeads.map((lead) => (
                      <div
                        key={lead.id}
                        className="flex items-center justify-between gap-2 rounded-lg border border-border px-3 py-2"
                      >
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium">
                            {lead.company}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {formatFullCurrency(lead.value)} · {lead.source}
                          </p>
                        </div>
                        <LeadStatusBadge status={lead.status} />
                      </div>
                    ))
                  )}
                </div>
              </div>
            </>
          ) : null}
        </SheetContent>
      </Sheet>

      <Dialog
        open={addOpen}
        onOpenChange={(open) => {
          setAddOpen(open);
          if (!open) setEditingId(null);
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{editingId ? "Edit contact" : "Add contact"}</DialogTitle>
            <DialogDescription>
              {editingId
                ? "Updates this contact in the browser session."
                : "Adds a demo contact to this browser session."}
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleSubmit} noValidate className="grid gap-4">
            <FormField label="Name" required error={errors.name}>
              {(p) => (
                <Input
                  {...p}
                  placeholder="Marcus Hale"
                  value={form.name}
                  onChange={(e) => setField("name", e.target.value)}
                />
              )}
            </FormField>
            <FormField label="Company" required error={errors.company}>
              {(p) =>
                companyNames.length === 0 ? (
                  <p className="text-sm text-muted-foreground" id={p.id}>
                    No companies yet — add a company first.
                  </p>
                ) : (
                  <Select
                    value={form.company}
                    onValueChange={(v) => setField("company", String(v))}
                  >
                    <SelectTrigger className="w-full" {...p} aria-label="Company">
                      {form.company || "Select a company"}
                    </SelectTrigger>
                    <SelectContent>
                      {companyNames.map((name) => (
                        <SelectItem key={name} value={name}>
                          {name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )
              }
            </FormField>
            <FormField label="Job title" required error={errors.title}>
              {(p) => (
                <Input
                  {...p}
                  placeholder="Owner"
                  value={form.title}
                  onChange={(e) => setField("title", e.target.value)}
                />
              )}
            </FormField>
            <FormField label="Email" required error={errors.email}>
              {(p) => (
                <Input
                  {...p}
                  type="email"
                  placeholder="name@company.example"
                  value={form.email}
                  onChange={(e) => setField("email", e.target.value)}
                />
              )}
            </FormField>
            <FormField label="Phone">
              {(p) => (
                <Input
                  {...p}
                  placeholder="+1 303 555 0142"
                  value={form.phone}
                  onChange={(e) => setField("phone", e.target.value)}
                />
              )}
            </FormField>
            <FormField label="LinkedIn">
              {(p) => (
                <Input
                  {...p}
                  placeholder="https://linkedin.com/in/owner"
                  value={form.linkedinUrl}
                  onChange={(e) => setField("linkedinUrl", e.target.value)}
                />
              )}
            </FormField>
            <FormField label="Instagram">
              {(p) => (
                <Input
                  {...p}
                  placeholder="https://instagram.com/owner"
                  value={form.instagramUrl}
                  onChange={(e) => setField("instagramUrl", e.target.value)}
                />
              )}
            </FormField>
            <FormField label="Facebook">
              {(p) => (
                <Input
                  {...p}
                  placeholder="https://facebook.com/owner"
                  value={form.facebookUrl}
                  onChange={(e) => setField("facebookUrl", e.target.value)}
                />
              )}
            </FormField>
            <FormField label="Owner" required>
              {(p) => (
                <Select
                  value={form.owner}
                  onValueChange={(v) => setField("owner", String(v))}
                >
                  <SelectTrigger className="w-full" {...p} aria-label="Owner">
                    {form.owner}
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
              )}
            </FormField>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setAddOpen(false);
                  setEditingId(null);
                }}
              >
                Cancel
              </Button>
              <Button type="submit">
                {editingId ? "Save changes" : "Add contact"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
        title="Delete contact?"
        description={
          deleteTarget
            ? `${deleteTarget.name} will be removed from this browser session. Related leads keep their own records. This cannot be undone.`
            : ""
        }
        onConfirm={confirmDelete}
      />
    </div>
  );
}
