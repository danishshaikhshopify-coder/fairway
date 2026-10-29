"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Globe, Mail, MapPin, Phone, Plus, RotateCcw } from "lucide-react";
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
import { Textarea } from "@/components/ui/textarea";
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
import {
  BusinessTypeBadge,
  LeadStatusBadge,
} from "@/components/crm/status-badge";
import { PageHeader } from "@/components/layout/page-header";
import { useCrm } from "@/lib/crm-store";
import { formatFullCurrency } from "@/lib/format";
import {
  BUSINESS_TYPES,
  COUNTRIES,
  OWNERS,
  type BusinessType,
  type Company,
  type Country,
} from "@/lib/types";

const ALL = "all";

const emptyCompanyForm = {
  name: "",
  businessType: "Seller" as BusinessType,
  city: "",
  region: "",
  country: "USA" as Country,
  website: "",
  email: "",
  phone: "",
  fitScore: "60",
  owner: OWNERS[0],
  notes: "",
};

type CompanyForm = typeof emptyCompanyForm;

function validateCompanyForm(form: CompanyForm): Record<string, string> {
  const errors: Record<string, string> = {};
  if (!form.name.trim()) errors.name = "Company name is required.";
  if (!form.city.trim()) errors.city = "City is required.";
  const fit = Number(form.fitScore);
  if (form.fitScore.trim() === "" || Number.isNaN(fit) || fit < 0 || fit > 100) {
    errors.fitScore = "Use a score between 0 and 100.";
  }
  return errors;
}

/** Website values are free text, so only add a scheme when the user did not. */
function websiteHref(url: string): string {
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(url) ? url : `https://${url}`;
}

function DetailRow({
  icon: Icon,
  label,
  value,
  href,
}: {
  icon: typeof Globe;
  label: string;
  value: string;
  href?: string;
}) {
  return (
    <div className="flex items-start gap-3 text-sm">
      <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      <div className="min-w-0">
        <p className="text-xs text-muted-foreground">{label}</p>
        {href ? (
          <a
            href={href}
            target="_blank"
            rel="noreferrer"
            className="break-words text-primary underline-offset-4 hover:underline"
          >
            {value}
          </a>
        ) : (
          <p className="break-words">{value}</p>
        )}
      </div>
    </div>
  );
}

export default function CompaniesPage() {
  const { companies, contacts, leads, addCompany, updateCompany, updateContact, updateLead, removeCompany, removeContact } =
    useCrm();

  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<string>(ALL);
  const [countryFilter, setCountryFilter] = useState<string>(ALL);
  const [sort, setSort] = useState<string>("name");
  const [page, setPage] = useState(1);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Company | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);

  const [addOpen, setAddOpen] = useState(false);
  const [form, setForm] = useState<CompanyForm>(emptyCompanyForm);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return companies.filter((company) => {
      if (typeFilter !== ALL && company.businessType !== typeFilter) return false;
      if (countryFilter !== ALL && company.country !== countryFilter) return false;
      if (!query) return true;
      return (
        company.name.toLowerCase().includes(query) ||
        company.city.toLowerCase().includes(query) ||
        company.region.toLowerCase().includes(query)
      );
    });
  }, [companies, search, typeFilter, countryFilter]);

  const sorted = useMemo(() => {
    const rows = [...filtered];
    switch (sort) {
      case "fit-desc":
        rows.sort((a, b) => b.fitScore - a.fitScore);
        break;
      case "city":
        rows.sort((a, b) => a.city.localeCompare(b.city));
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

  const detailCompany = companies.find((c) => c.id === detailId) ?? null;
  const detailContacts = detailCompany
    ? contacts.filter((c) => c.company === detailCompany.name)
    : [];
  const detailLeads = detailCompany
    ? leads.filter((l) => l.company === detailCompany.name)
    : [];

  const filtersActive =
    search.trim() !== "" || typeFilter !== ALL || countryFilter !== ALL;

  function resetFilters() {
    setSearch("");
    setTypeFilter(ALL);
    setCountryFilter(ALL);
    setPage(1);
  }

  function setField<K extends keyof CompanyForm>(key: K, value: CompanyForm[K]) {
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
    const name = deleteTarget.name;
    // Mirror the DB cascade: contacts hang off the company; leads keep their
    // own record (B1: leads.company_id is ON DELETE SET NULL).
    const linkedContacts = contacts.filter((c) => c.company === name);
    linkedContacts.forEach((c) => removeContact(c.id));
    removeCompany(deleteTarget.id);
    if (detailId === deleteTarget.id) setDetailId(null);
    setDeleteTarget(null);
    toast.success(
      linkedContacts.length > 0
        ? `${name} deleted with ${linkedContacts.length} linked contact${linkedContacts.length === 1 ? "" : "s"}.`
        : `${name} deleted.`,
    );
  }

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    const nextErrors = validateCompanyForm(form);
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) {
      toast.error("Fix the highlighted fields before adding the company.");
      return;
    }
    const existing = companies.find(
      (c) =>
        c.id !== editingId &&
        c.name.trim().toLowerCase() === form.name.trim().toLowerCase(),
    );
    if (existing) {
      setErrors({ name: "A company with this name already exists." });
      toast.error(`"${existing.name}" already exists — duplicate not added.`);
      return;
    }
    const company: Omit<Company, "id"> = {
      name: form.name.trim(),
      businessType: form.businessType,
      city: form.city.trim(),
      region: form.region.trim(),
      country: form.country,
      website: form.website.trim(),
      email: form.email.trim(),
      phone: form.phone.trim(),
      fitScore: Number(form.fitScore),
      owner: form.owner,
      notes: form.notes.trim(),
    };
    if (editingId) {
      const previous = companies.find((c) => c.id === editingId);
      updateCompany(editingId, company);
      // The store joins contacts/leads on the company NAME string (the DB uses
      // FKs); propagate a rename so existing relationships stay intact.
      if (previous && previous.name !== company.name) {
        contacts
          .filter((c) => c.company === previous.name)
          .forEach((c) => updateContact(c.id, { company: company.name }));
        leads
          .filter((l) => l.company === previous.name)
          .forEach((l) => updateLead(l.id, { company: company.name }));
      }
      setForm(emptyCompanyForm);
      setErrors({});
      setAddOpen(false);
      setEditingId(null);
      toast.success(`${company.name} updated.`);
      return;
    }
    addCompany(company);
    setForm(emptyCompanyForm);
    setErrors({});
    setAddOpen(false);
    setPage(1);
    toast.success(`${company.name} added.`);
  }

  function openEdit(company: Company) {
    setForm({
      name: company.name,
      businessType: company.businessType,
      city: company.city,
      region: company.region,
      country: company.country,
      website: company.website,
      email: company.email,
      phone: company.phone,
      fitScore: String(company.fitScore),
      owner: company.owner,
      notes: company.notes,
    });
    setErrors({});
    setEditingId(company.id);
    setAddOpen(true);
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Companies"
        actions={
          <Button onClick={() => setAddOpen(true)}>
            <Plus aria-hidden="true" />
            Add company
          </Button>
        }
      />

      <Card>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            <div className="min-w-48 flex-1">
              <Input
                aria-label="Search companies"
                placeholder="Search name, city or region…"
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setPage(1);
                }}
              />
            </div>
            <Select
              value={typeFilter}
              onValueChange={(v) => {
                setTypeFilter(String(v));
                setPage(1);
              }}
            >
              <SelectTrigger className="w-40" aria-label="Filter by type">
                {typeFilter === ALL ? "All types" : typeFilter}
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All types</SelectItem>
                {BUSINESS_TYPES.map((type) => (
                  <SelectItem key={type} value={type}>
                    {type}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select
              value={countryFilter}
              onValueChange={(v) => {
                setCountryFilter(String(v));
                setPage(1);
              }}
            >
              <SelectTrigger className="w-36" aria-label="Filter by country">
                {countryFilter === ALL ? "All countries" : countryFilter}
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All countries</SelectItem>
                {COUNTRIES.map((country) => (
                  <SelectItem key={country} value={country}>
                    {country}
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
              <SelectTrigger className="w-44" aria-label="Sort companies">
                {sort === "fit-desc"
                  ? "Fit score (high–low)"
                  : sort === "city"
                    ? "City (A–Z)"
                    : "Name (A–Z)"}
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="name">Name (A–Z)</SelectItem>
                <SelectItem value="fit-desc">Fit score (high–low)</SelectItem>
                <SelectItem value="city">City (A–Z)</SelectItem>
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
                filtersActive ? "No companies match your filters" : "No companies yet"
              }
              description={
                filtersActive
                  ? "Try clearing the search or filters."
                  : "Add your first company to track venues and their contacts."
              }
              action={
                filtersActive ? (
                  <Button variant="outline" onClick={resetFilters}>
                    Clear filters
                  </Button>
                ) : (
                  <Button onClick={() => setAddOpen(true)}>
                    <Plus aria-hidden="true" />
                    Add company
                  </Button>
                )
              }
            />
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Company</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead className="hidden md:table-cell">Location</TableHead>
                    <TableHead className="text-right">Fit score</TableHead>
                    <TableHead className="hidden text-right lg:table-cell">
                      Contacts
                    </TableHead>
                    <TableHead className="hidden xl:table-cell">Owner</TableHead>
                    <TableHead className="w-20" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {pageRows.map((company) => (
                    <TableRow key={company.id}>
                      <TableCell>
                        <div className="min-w-40">
                          <p className="font-medium">{company.name}</p>
                          <p className="text-xs text-muted-foreground">
                            {company.website || "No website"}
                          </p>
                        </div>
                      </TableCell>
                      <TableCell>
                        <BusinessTypeBadge type={company.businessType} />
                      </TableCell>
                      <TableCell className="hidden text-sm whitespace-nowrap text-muted-foreground md:table-cell">
                        {[company.city, company.region].filter(Boolean).join(", ")} ·{" "}
                        {company.country}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {company.fitScore}
                      </TableCell>
                      <TableCell className="hidden text-right tabular-nums lg:table-cell">
                        {contacts.filter((c) => c.company === company.name).length}
                      </TableCell>
                      <TableCell className="hidden text-sm text-muted-foreground xl:table-cell">
                        {company.owner}
                      </TableCell>
                      <TableCell>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setDetailId(company.id)}
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
              {sorted.length} of {companies.length} companies
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
          {detailCompany ? (
            <>
              <SheetHeader className="border-b border-border p-4">
                <SheetTitle className="text-base">
                  {detailCompany.name}
                </SheetTitle>
                <SheetDescription className="flex items-center gap-2">
                  <BusinessTypeBadge type={detailCompany.businessType} />
                  <span className="text-xs">
                    Owner: {detailCompany.owner}
                  </span>
                </SheetDescription>
                <div className="flex gap-2 pt-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => openEdit(detailCompany)}
                  >
                    Edit
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setDeleteTarget(detailCompany)}
                  >
                    Delete company
                  </Button>
                </div>
              </SheetHeader>
              <div className="space-y-5 p-4">
                <div className="space-y-3">
                  <DetailRow
                    icon={MapPin}
                    label="Location"
                    value={[detailCompany.city, detailCompany.region, detailCompany.country]
                      .filter(Boolean)
                      .join(", ")}
                  />
                  {detailCompany.website ? (
                    <DetailRow
                      icon={Globe}
                      label="Website"
                      value={detailCompany.website}
                      href={websiteHref(detailCompany.website)}
                    />
                  ) : null}
                  {detailCompany.email ? (
                    <DetailRow
                      icon={Mail}
                      label="Email"
                      value={detailCompany.email}
                      href={`mailto:${detailCompany.email}`}
                    />
                  ) : null}
                  {detailCompany.phone ? (
                    <DetailRow icon={Phone} label="Phone" value={detailCompany.phone} />
                  ) : null}
                </div>

                <Separator />

                <div className="space-y-1.5">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">Business-fit score</span>
                    <span className="font-medium tabular-nums">
                      {detailCompany.fitScore}/100
                    </span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full rounded-full bg-primary"
                      style={{ width: `${detailCompany.fitScore}%` }}
                    />
                  </div>
                </div>

                {detailCompany.notes ? (
                  <>
                    <Separator />
                    <div className="space-y-1">
                      <p className="text-xs text-muted-foreground">Notes</p>
                      <p className="text-sm leading-6">{detailCompany.notes}</p>
                    </div>
                  </>
                ) : null}

                <Separator />

                <div className="space-y-2">
                  <p className="text-sm font-medium">
                    Contacts ({detailContacts.length})
                  </p>
                  {detailContacts.length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                      No contacts linked to this company yet.
                    </p>
                  ) : (
                    detailContacts.map((contact) => (
                      <div
                        key={contact.id}
                        className="rounded-lg border border-border px-3 py-2"
                      >
                        <p className="text-sm font-medium">{contact.name}</p>
                        <p className="text-xs text-muted-foreground">
                          {contact.title} · {contact.email}
                        </p>
                      </div>
                    ))
                  )}
                </div>

                <Separator />

                <div className="space-y-2">
                  <p className="text-sm font-medium">
                    Leads ({detailLeads.length})
                  </p>
                  {detailLeads.length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                      No leads linked to this company yet.
                    </p>
                  ) : (
                    detailLeads.map((lead) => (
                      <div
                        key={lead.id}
                        className="flex items-center justify-between gap-2 rounded-lg border border-border px-3 py-2"
                      >
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium">
                            {lead.contact}
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
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{editingId ? "Edit company" : "Add company"}</DialogTitle>
            <DialogDescription>
              {editingId
                ? "Updates this company in the browser session."
                : "Adds a demo company to this browser session."}
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleSubmit} noValidate className="grid gap-4 sm:grid-cols-2">
            <FormField label="Name" required error={errors.name} className="sm:col-span-2">
              {(p) => (
                <Input
                  {...p}
                  placeholder="Apex Indoor Golf"
                  value={form.name}
                  onChange={(e) => setField("name", e.target.value)}
                />
              )}
            </FormField>
            <FormField label="Business type" required>
              {(p) => (
                <Select
                  value={form.businessType}
                  onValueChange={(v) => setField("businessType", v as BusinessType)}
                >
                  <SelectTrigger className="w-full" {...p} aria-label="Business type">
                    {form.businessType}
                  </SelectTrigger>
                  <SelectContent>
                    {BUSINESS_TYPES.map((type) => (
                      <SelectItem key={type} value={type}>
                        {type}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </FormField>
            <FormField label="Country" required>
              {(p) => (
                <Select
                  value={form.country}
                  onValueChange={(v) => setField("country", v as Country)}
                >
                  <SelectTrigger className="w-full" {...p} aria-label="Country">
                    {form.country}
                  </SelectTrigger>
                  <SelectContent>
                    {COUNTRIES.map((country) => (
                      <SelectItem key={country} value={country}>
                        {country}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </FormField>
            <FormField label="City" required error={errors.city}>
              {(p) => (
                <Input
                  {...p}
                  placeholder="Denver"
                  value={form.city}
                  onChange={(e) => setField("city", e.target.value)}
                />
              )}
            </FormField>
            <FormField label="State / region">
              {(p) => (
                <Input
                  {...p}
                  placeholder="CO"
                  value={form.region}
                  onChange={(e) => setField("region", e.target.value)}
                />
              )}
            </FormField>
            <FormField label="Website">
              {(p) => (
                <Input
                  {...p}
                  placeholder="example.example"
                  value={form.website}
                  onChange={(e) => setField("website", e.target.value)}
                />
              )}
            </FormField>
            <FormField label="Email">
              {(p) => (
                <Input
                  {...p}
                  type="email"
                  placeholder="hello@company.example"
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
            <FormField label="Fit score (0-100)" error={errors.fitScore}>
              {(p) => (
                <Input
                  {...p}
                  type="number"
                  min={0}
                  max={100}
                  value={form.fitScore}
                  onChange={(e) => setField("fitScore", e.target.value)}
                />
              )}
            </FormField>
            <FormField label="Owner" required className="sm:col-span-2">
              {(p) => (
                <Select
                  value={form.owner}
                  onValueChange={(v) => setField("owner", String(v))}
                >
                  <SelectTrigger className="w-full" {...p} aria-label="Owner">
                    {form.owner}
                  </SelectTrigger>
                  <SelectContent>
                    {OWNERS.map((owner) => (
                      <SelectItem key={owner} value={owner}>
                        {owner}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </FormField>
            <FormField label="Notes" className="sm:col-span-2">
              {(p) => (
                <Textarea
                  {...p}
                  placeholder="Install volume, decision makers, context…"
                  value={form.notes}
                  onChange={(e) => setField("notes", e.target.value)}
                  rows={3}
                />
              )}
            </FormField>
            <DialogFooter className="sm:col-span-2">
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
                {editingId ? "Save changes" : "Add company"}
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
        title="Delete company?"
        description={
          deleteTarget
            ? `"${deleteTarget.name}" and its ${contacts.filter((c) => c.company === deleteTarget.name).length} linked contact(s) will be removed from this browser session. This cannot be undone.`
            : ""
        }
        onConfirm={confirmDelete}
      />
    </div>
  );
}
