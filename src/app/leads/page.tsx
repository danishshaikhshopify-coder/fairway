"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { motion } from "motion/react";
import { toast } from "sonner";
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Download,
  Mail,
  MoreHorizontal,
  Pencil,
  Phone,
  Plus,
  RotateCcw,
  Upload,
  User,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
import {
  BusinessTypeBadge,
  LeadStatusBadge,
  QualificationBadge,
} from "@/components/crm/status-badge";
import { PageHeader } from "@/components/layout/page-header";
import { useCrm } from "@/lib/crm-store";
import { isLiveMode } from "@/lib/supabase/client";
import { findDuplicateLead, validateLeadForm, type LeadForm } from "@/lib/lead-form";
import { loadPreferences } from "@/lib/preferences";
import {
  downloadCsv,
  importLeadsCsv,
  leadsToCsv,
  type ImportResult,
} from "@/lib/lead-csv";
import { useOpenFromQuery } from "@/lib/use-open-from-query";
import { useToday } from "@/lib/use-today";
import { fadeUp, staggerList } from "@/lib/motion";
import { cn } from "@/lib/utils";
import { formatDate, formatFullCurrency, isOverdue, plusDaysIso, todayIso } from "@/lib/format";
import {
  BUSINESS_TYPES,
  LEAD_SOURCES,
  LEAD_STATUSES,
  LEAD_STATUS_LABELS,
  OWNERS,
  type Lead,
  type LeadSource,
  type LeadStatus,
  type BusinessType,
} from "@/lib/types";

const PAGE_SIZE = 6;

const SORT_OPTIONS = [
  { value: "score", label: "Score (high to low)" },
  { value: "value", label: "Value (high to low)" },
  { value: "followUp", label: "Next follow-up (soonest)" },
  { value: "lastContact", label: "Last contact (recent first)" },
  { value: "company", label: "Company (A to Z)" },
] as const;

type SortKey = (typeof SORT_OPTIONS)[number]["value"];

const ALL = "all";

const emptyLeadForm = {
  company: "",
  contact: "",
  email: "",
  phone: "",
  source: "Website" as LeadSource,
  businessType: "Seller" as BusinessType,
  value: "",
  score: "50",
  fitScore: "50",
  owner: isLiveMode() ? "" : OWNERS[0],
  nextFollowUp: "",
};

function LeadRowMenu({
  lead,
  onView,
  onMove,
  onDelete,
}: {
  lead: Lead;
  onView: () => void;
  onMove: (status: LeadStatus) => void;
  onDelete: () => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={`Actions for ${lead.company}`}
          />
        }
      >
        <MoreHorizontal aria-hidden="true" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={onView}>View details</DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuLabel>Move to</DropdownMenuLabel>
        {LEAD_STATUSES.map((status) => (
          <DropdownMenuItem
            key={status}
            disabled={status === lead.status}
            onClick={() => onMove(status)}
          >
            {LEAD_STATUS_LABELS[status]}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive" onClick={onDelete}>
          Delete lead
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function DetailRow({
  icon: Icon,
  label,
  value,
  href,
}: {
  icon: typeof Mail;
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
            className="break-all text-primary underline-offset-4 hover:underline"
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

export default function LeadsPage() {
  const { leads, owners, addLead, updateLead, setLeadStatuses, removeLead } = useCrm();
  const today = useToday();

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>(ALL);
  const [sourceFilter, setSourceFilter] = useState<string>(ALL);
  const [sort, setSort] = useState<SortKey>("score");
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<string[]>([]);

  const [detailId, setDetailId] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Lead | null>(null);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Deep link (?lead=<id>) from the dashboard attention list and the pipeline
  // board. Read client-side so the statically prerendered page needs no
  // Suspense boundary for useSearchParams; opening one tick later keeps the
  // first render identical to the server HTML (no hydration mismatch).
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("lead");
    if (!id) return;
    const timer = setTimeout(() => {
      if (leads.some((l) => l.id === id)) setDetailId(id);
    }, 0);
    return () => clearTimeout(timer);
    // Only on mount: later navigations keep the user's own sheet state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // Command palette "New lead" (/leads?new=1).
  useOpenFromQuery("new", () => openAdd());
  const [form, setForm] = useState<LeadForm>(emptyLeadForm);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return leads.filter((lead) => {
      if (statusFilter !== ALL && lead.status !== statusFilter) return false;
      if (sourceFilter !== ALL && lead.source !== sourceFilter) return false;
      if (!query) return true;
      return (
        lead.company.toLowerCase().includes(query) ||
        lead.contact.toLowerCase().includes(query) ||
        lead.email.toLowerCase().includes(query)
      );
    });
  }, [leads, search, statusFilter, sourceFilter]);

  const sorted = useMemo(() => {
    const rows = [...filtered];
    switch (sort) {
      case "value":
        rows.sort((a, b) => b.value - a.value);
        break;
      case "followUp":
        rows.sort((a, b) =>
          (a.nextFollowUp || "9999-12-31").localeCompare(
            b.nextFollowUp || "9999-12-31",
          ),
        );
        break;
      case "lastContact":
        rows.sort((a, b) => b.lastContact.localeCompare(a.lastContact));
        break;
      case "company":
        rows.sort((a, b) => a.company.localeCompare(b.company));
        break;
      default:
        rows.sort((a, b) => b.score - a.score);
    }
    return rows;
  }, [filtered, sort]);

  const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const pageRows = sorted.slice(
    (currentPage - 1) * PAGE_SIZE,
    currentPage * PAGE_SIZE,
  );

  const filtersActive =
    search.trim() !== "" || statusFilter !== ALL || sourceFilter !== ALL;

  const detailLead = leads.find((l) => l.id === detailId) ?? null;

  function resetFilters() {
    setSearch("");
    setStatusFilter(ALL);
    setSourceFilter(ALL);
    setPage(1);
    setSelected([]);
  }

  function toggleRow(id: string) {
    setSelected((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  }

  function togglePage() {
    const pageIds = pageRows.map((r) => r.id);
    const allSelected = pageIds.length > 0 && pageIds.every((id) => selected.includes(id));
    setSelected((prev) =>
      allSelected
        ? prev.filter((id) => !pageIds.includes(id))
        : [...new Set([...prev, ...pageIds])],
    );
  }

  function changeStatus(ids: string[], status: LeadStatus) {
    if (ids.length === 0) return;
    setLeadStatuses(ids, status);
    toast.success(
      ids.length === 1
        ? `Lead moved to ${LEAD_STATUS_LABELS[status]}.`
        : `${ids.length} leads moved to ${LEAD_STATUS_LABELS[status]}.`,
    );
    setSelected((prev) => prev.filter((id) => !ids.includes(id)));
  }

  function setField<K extends keyof LeadForm>(key: K, value: LeadForm[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
    // Drop the stale error for the field being corrected.
    setErrors((prev) => {
      if (!(key in prev)) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });
  }

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    const nextErrors = validateLeadForm(form);
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) {
      toast.error("Fix the highlighted fields before adding the lead.");
      return;
    }
    const duplicate = findDuplicateLead(
      leads.filter((l) => l.id !== editingId),
      form,
    );
    if (duplicate) {
      setErrors({
        email: `A lead for ${duplicate.company} with this email already exists.`,
      });
      toast.error(
        `Possible duplicate — ${duplicate.company} already has a lead with this email.`,
      );
      return;
    }
    const lead: Omit<Lead, "id"> = {
      company: form.company.trim(),
      contact: form.contact.trim(),
      email: form.email.trim(),
      phone: form.phone.trim(),
      source: form.source,
      status: "new",
      score: Number(form.score),
      fitScore: Number(form.fitScore),
      businessType: form.businessType,
      value: Number(form.value),
      owner: form.owner,
      lastContact: todayIso(),
      nextFollowUp: form.nextFollowUp,
      evidence: "Added manually in the demo UI — no automated scoring applied.",
      followUpEvidence: "No follow-up history captured yet.",
      qualification: "Pending",
      recommendedAction: "Run a first discovery call and capture qualification notes.",
    };
    if (editingId) {
      updateLead(editingId, {
        company: lead.company,
        contact: lead.contact,
        email: lead.email,
        phone: lead.phone,
        source: lead.source,
        businessType: lead.businessType,
        value: lead.value,
        score: lead.score,
        fitScore: lead.fitScore,
        owner: lead.owner,
        nextFollowUp: lead.nextFollowUp,
      });
      setForm(emptyLeadForm);
      setErrors({});
      setAddOpen(false);
      setEditingId(null);
      toast.success(`Lead updated for ${lead.company}.`);
      return;
    }
    addLead(lead);
    setForm(emptyLeadForm);
    setErrors({});
    setAddOpen(false);
    setPage(1);
    toast.success(`Lead added for ${lead.company}.`);
  }

  // Add dialog, prefilled from the saved CRM preferences (Settings → CRM):
  // default owner, and a follow-up due date = today + the follow-up window.
  function openAdd() {
    const prefs = loadPreferences();
    setForm({
      ...emptyLeadForm,
      owner: prefs.defaultOwner,
      nextFollowUp: plusDaysIso(prefs.followUpDays),
    });
    setErrors({});
    setEditingId(null);
    setAddOpen(true);
  }

  function openEdit(lead: Lead) {
    setForm({
      company: lead.company,
      contact: lead.contact,
      email: lead.email,
      phone: lead.phone,
      source: lead.source,
      businessType: lead.businessType,
      value: String(lead.value),
      score: String(lead.score),
      fitScore: String(lead.fitScore),
      owner: lead.owner,
      nextFollowUp: lead.nextFollowUp,
    });
    setErrors({});
    setEditingId(lead.id);
    setAddOpen(true);
  }

  const pageIds = pageRows.map((r) => r.id);
  const allPageSelected =
    pageIds.length > 0 && pageIds.every((id) => selected.includes(id));

  const countLabel =
    sorted.length === leads.length
      ? `${leads.length} lead${leads.length === 1 ? "" : "s"}`
      : `${sorted.length} of ${leads.length} leads`;

  const menuHandlers = (lead: Lead) => ({
    onView: () => setDetailId(lead.id),
    onMove: (status: LeadStatus) => changeStatus([lead.id], status),
    onDelete: () => setDeleteTarget(lead),
  });

  function confirmDelete() {
    if (!deleteTarget) return;
    removeLead(deleteTarget.id);
    if (detailId === deleteTarget.id) setDetailId(null);
    setSelected((prev) => prev.filter((id) => id !== deleteTarget.id));
    toast.success(`Lead deleted for ${deleteTarget.company}.`);
    setDeleteTarget(null);
  }

  function handleExport() {
    if (leads.length === 0) {
      toast.error("No leads to export.");
      return;
    }
    downloadCsv(`fairway-leads-${todayIso()}.csv`, leadsToCsv(leads));
    toast.success(`${leads.length} leads exported to CSV.`);
  }

  function handleImportFile(file: File) {
    file
      .text()
      .then((text) => {
        const result = importLeadsCsv(text, leads);
        if (result.fatal.length > 0) {
          toast.error(result.fatal[0]);
          return;
        }
        if (result.rows.length === 0) {
          toast.error("The file has no data rows.");
          return;
        }
        setImportResult(result);
      })
      .catch(() => toast.error("Could not read that file."));
  }

  // NOTE: CSV import is optimistic and per-row. In live mode each valid row is
  // persisted via addLead (background insert), but there is no transactional
  // rollback if a row fails, and no `lead_imports` audit row is written yet.
  // Failed rows are reported to the user but already-attempted inserts may
  // remain. Treat this as non-atomic until a server-side import endpoint exists.
  function confirmImport() {
    if (!importResult) return;
    importResult.valid.forEach((row) => {
      if (row.lead) addLead(row.lead);
    });
    const created = importResult.valid.length;
    const failed = importResult.failed.length;
    setImportResult(null);
    setPage(1);
    if (failed > 0) {
      toast.success(
        `${created} lead${created === 1 ? "" : "s"} imported — ${failed} row${failed === 1 ? "" : "s"} skipped (see the import report).`,
      );
    } else {
      toast.success(`${created} lead${created === 1 ? "" : "s"} imported.`);
    }
  }

  return (
    <motion.div
      className="space-y-4 sm:space-y-6"
      variants={staggerList}
      initial="hidden"
      animate="show"
    >
      <PageHeader
        title="Leads"
        description={countLabel}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              aria-hidden="true"
              tabIndex={-1}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) handleImportFile(file);
                e.target.value = ""; // allow re-picking the same file
              }}
            />
            <Button
              variant="outline"
              onClick={() => fileInputRef.current?.click()}
            >
              <Upload aria-hidden="true" />
              Import CSV
            </Button>
            <Button variant="outline" onClick={handleExport}>
              <Download aria-hidden="true" />
              Export CSV
            </Button>
            <Button onClick={openAdd}>
              <Plus aria-hidden="true" />
              Add lead
            </Button>
          </div>
        }
      />

      <motion.div variants={fadeUp}>
      <Card>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            <div className="min-w-44 flex-1">
              <Input
                aria-label="Search leads"
                placeholder="Search company, contact or email…"
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setPage(1);
                  setSelected([]);
                }}
              />
            </div>
            <Select
              value={statusFilter}
              onValueChange={(v) => {
                setStatusFilter(String(v));
                setPage(1);
                setSelected([]);
              }}
            >
              <SelectTrigger className="w-36" aria-label="Filter by status">
                {statusFilter === ALL
                  ? "All statuses"
                  : LEAD_STATUS_LABELS[statusFilter as LeadStatus]}
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All statuses</SelectItem>
                {LEAD_STATUSES.map((status) => (
                  <SelectItem key={status} value={status}>
                    {LEAD_STATUS_LABELS[status]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select
              value={sourceFilter}
              onValueChange={(v) => {
                setSourceFilter(String(v));
                setPage(1);
                setSelected([]);
              }}
            >
              <SelectTrigger className="w-32" aria-label="Filter by source">
                {sourceFilter === ALL ? "All sources" : sourceFilter}
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All sources</SelectItem>
                {LEAD_SOURCES.map((source) => (
                  <SelectItem key={source} value={source}>
                    {source}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select
              value={sort}
              onValueChange={(v) => {
                setSort(v as SortKey);
                setPage(1);
              }}
            >
              <SelectTrigger className="w-44 sm:w-52" aria-label="Sort leads">
                {SORT_OPTIONS.find((o) => o.value === sort)?.label}
              </SelectTrigger>
              <SelectContent>
                {SORT_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {filtersActive ? (
              <Button variant="ghost" onClick={resetFilters}>
                <RotateCcw aria-hidden="true" />
                Clear
              </Button>
            ) : null}
          </div>

          {selected.length > 0 ? (
            <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-muted/50 px-3 py-2">
              <span className="text-sm font-medium">
                {selected.length} selected
              </span>
              <Select onValueChange={(v) => changeStatus(selected, v as LeadStatus)}>
                <SelectTrigger className="w-44" aria-label="Bulk set status">
                  Set status…
                </SelectTrigger>
                <SelectContent>
                  {LEAD_STATUSES.map((status) => (
                    <SelectItem key={status} value={status}>
                      {LEAD_STATUS_LABELS[status]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button variant="ghost" size="sm" onClick={() => setSelected([])}>
                Clear selection
              </Button>
            </div>
          ) : null}

          {sorted.length === 0 ? (
            <EmptyState
              title={leads.length === 0 ? "No leads yet" : "No leads match your filters"}
              description={
                leads.length === 0
                  ? "Add your first lead to start tracking your pipeline."
                  : "Try clearing the search or filters."
              }
              action={
                leads.length === 0 ? (
                  <Button onClick={openAdd}>
                    <Plus aria-hidden="true" />
                    Add lead
                  </Button>
                ) : (
                  <Button variant="outline" onClick={resetFilters}>
                    Clear filters
                  </Button>
                )
              }
            />
          ) : (
            <>
              {/* Desktop: table */}
              <div className="hidden overflow-x-auto md:block">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-10">
                        <Checkbox
                          checked={allPageSelected}
                          aria-label={
                            allPageSelected
                              ? "Clear page selection"
                              : "Select all leads on this page"
                          }
                          onCheckedChange={togglePage}
                        />
                      </TableHead>
                      <TableHead>Lead</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Score</TableHead>
                      <TableHead className="text-right">Value</TableHead>
                      <TableHead>Owner</TableHead>
                      <TableHead>Next follow-up</TableHead>
                      <TableHead className="w-10" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {pageRows.map((lead) => {
                      const overdue =
                        lead.status !== "won" &&
                        lead.status !== "lost" &&
                        isOverdue(lead.nextFollowUp, today);
                      return (
                        <TableRow
                          key={lead.id}
                          data-selected={selected.includes(lead.id) ? "true" : undefined}
                          className="data-[selected=true]:bg-muted/50"
                        >
                          <TableCell>
                            <Checkbox
                              checked={selected.includes(lead.id)}
                              aria-label={`Select ${lead.company}`}
                              onCheckedChange={() => toggleRow(lead.id)}
                            />
                          </TableCell>
                          <TableCell>
                            <div className="min-w-40">
                              <button
                                type="button"
                                onClick={() => setDetailId(lead.id)}
                                className="rounded-sm font-medium outline-none hover:text-primary hover:underline focus-visible:ring-3 focus-visible:ring-ring/50"
                              >
                                {lead.company}
                              </button>
                              <p className="text-xs text-muted-foreground">
                                {lead.contact}
                              </p>
                            </div>
                          </TableCell>
                          <TableCell>
                            <LeadStatusBadge status={lead.status} />
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {lead.score}
                          </TableCell>
                          <TableCell className="text-right font-medium tabular-nums">
                            {formatFullCurrency(lead.value)}
                          </TableCell>
                          <TableCell className="text-sm text-muted-foreground">
                            {lead.owner}
                          </TableCell>
                          <TableCell className="text-sm whitespace-nowrap">
                            {lead.nextFollowUp ? (
                              <span
                                className={
                                  overdue
                                    ? "font-medium text-destructive"
                                    : undefined
                                }
                              >
                                {formatDate(lead.nextFollowUp)}
                                {overdue ? " · overdue" : ""}
                              </span>
                            ) : (
                              <span className="text-muted-foreground">—</span>
                            )}
                          </TableCell>
                          <TableCell>
                            <LeadRowMenu lead={lead} {...menuHandlers(lead)} />
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>

              {/* Mobile: cards */}
              <ul className="space-y-2.5 md:hidden">
                {pageRows.map((lead) => {
                  const overdue =
                    lead.status !== "won" &&
                    lead.status !== "lost" &&
                    isOverdue(lead.nextFollowUp, today);
                  return (
                    <li
                      key={lead.id}
                      className="rounded-xl border border-border bg-card p-3.5"
                    >
                      <div className="flex items-start gap-2.5">
                        <Checkbox
                          checked={selected.includes(lead.id)}
                          aria-label={`Select ${lead.company}`}
                          className="mt-1.5"
                          onCheckedChange={() => toggleRow(lead.id)}
                        />
                        <button
                          type="button"
                          onClick={() => setDetailId(lead.id)}
                          className="min-w-0 flex-1 rounded-sm text-left outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
                        >
                          <span className="block truncate text-sm font-semibold">
                            {lead.company}
                          </span>
                          <span className="block truncate text-xs text-muted-foreground">
                            {lead.contact}
                          </span>
                        </button>
                        <LeadRowMenu lead={lead} {...menuHandlers(lead)} />
                      </div>
                      <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1.5 pl-9">
                        <LeadStatusBadge status={lead.status} />
                        <span className="text-sm font-medium tabular-nums">
                          {formatFullCurrency(lead.value)}
                        </span>
                        <span className="text-xs text-muted-foreground tabular-nums">
                          Score {lead.score}
                        </span>
                        {lead.nextFollowUp ? (
                          <span
                            className={cn(
                              "ml-auto text-xs whitespace-nowrap",
                              overdue && "font-medium text-destructive",
                            )}
                          >
                            {overdue ? "Overdue " : ""}
                            {formatDate(lead.nextFollowUp)}
                          </span>
                        ) : null}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </>
          )}

          {sorted.length > 0 ? (
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm text-muted-foreground tabular-nums">
                {sorted.length} in total · page {currentPage} of {totalPages}
              </p>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="icon-sm"
                  aria-label="Previous page"
                  disabled={currentPage <= 1}
                  onClick={() => setPage(currentPage - 1)}
                >
                  <ChevronLeft aria-hidden="true" />
                </Button>
                <Button
                  variant="outline"
                  size="icon-sm"
                  aria-label="Next page"
                  disabled={currentPage >= totalPages}
                  onClick={() => setPage(currentPage + 1)}
                >
                  <ChevronRight aria-hidden="true" />
                </Button>
              </div>
            </div>
          ) : null}
        </CardContent>
      </Card>
      </motion.div>

      {/* Lead detail */}
      <Sheet
        open={detailId !== null}
        onOpenChange={(open) => {
          if (!open) setDetailId(null);
        }}
      >
        <SheetContent className="w-full gap-0 overflow-y-auto sm:max-w-md">
          {detailLead ? (
            <>
              <SheetHeader className="border-b border-border p-4">
                <SheetTitle className="pr-10 text-base">
                  {detailLead.company}
                </SheetTitle>
                <SheetDescription className="flex items-center gap-2">
                  <BusinessTypeBadge type={detailLead.businessType} />
                  <span className="text-xs">{detailLead.contact}</span>
                </SheetDescription>
              </SheetHeader>
              <div className="space-y-5 p-4">
                <div className="flex justify-end gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => openEdit(detailLead)}
                  >
                    <Pencil aria-hidden="true" />
                    Edit lead
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setDeleteTarget(detailLead)}
                  >
                    Delete
                  </Button>
                </div>
                <div className="grid grid-cols-3 gap-3 rounded-lg bg-muted/50 p-3 text-center">
                  <div>
                    <p className="text-xs text-muted-foreground">Value</p>
                    <p className="mt-0.5 text-sm font-semibold tabular-nums">
                      {formatFullCurrency(detailLead.value)}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Score</p>
                    <p className="mt-0.5 text-sm font-semibold tabular-nums">
                      {detailLead.score}/100
                    </p>
                    <div className="mt-1.5 h-1 overflow-hidden rounded-sm bg-background">
                      <div
                        className="h-full origin-left rounded-r-sm bg-primary transition-transform"
                        style={{ width: "100%", transform: `scaleX(${detailLead.score / 100})` }}
                      />
                    </div>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Fit</p>
                    <p className="mt-0.5 text-sm font-semibold tabular-nums">
                      {detailLead.fitScore}/100
                    </p>
                    <div className="mt-1.5 h-1 overflow-hidden rounded-sm bg-background">
                      <div
                        className="h-full origin-left rounded-r-sm bg-primary transition-transform"
                        style={{ width: "100%", transform: `scaleX(${detailLead.fitScore / 100})` }}
                      />
                    </div>
                  </div>
                </div>

                <div className="space-y-3">
                  <DetailRow
                    icon={Mail}
                    label="Email"
                    value={detailLead.email}
                    href={`mailto:${detailLead.email}`}
                  />
                  {detailLead.phone ? (
                    <DetailRow icon={Phone} label="Phone" value={detailLead.phone} />
                  ) : null}
                  <DetailRow icon={User} label="Owner" value={detailLead.owner} />
                  <DetailRow
                    icon={RotateCcw}
                    label="Source"
                    value={detailLead.source}
                  />
                </div>

                <Separator />

                <div className="space-y-1.5">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">Next follow-up</span>
                    <span
                      className={cn(
                        "font-medium",
                        isOverdue(detailLead.nextFollowUp, today) &&
                          detailLead.status !== "won" &&
                          detailLead.status !== "lost" &&
                          "text-destructive",
                      )}
                    >
                      {detailLead.nextFollowUp
                        ? formatDate(detailLead.nextFollowUp)
                        : "None scheduled"}
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">Last contact</span>
                    <span>{formatDate(detailLead.lastContact)}</span>
                  </div>
                  <div className="flex items-center justify-between gap-3 text-sm">
                    <span className="text-muted-foreground">Qualification</span>
                    <QualificationBadge qualification={detailLead.qualification} />
                  </div>
                </div>

                <Separator />

                <div className="space-y-1.5">
                  <p className="text-xs text-muted-foreground">Stage</p>
                  <Select
                    value={detailLead.status}
                    onValueChange={(v) =>
                      changeStatus([detailLead.id], v as LeadStatus)
                    }
                  >
                    <SelectTrigger className="w-full" aria-label="Change stage">
                      <LeadStatusBadge status={detailLead.status} />
                    </SelectTrigger>
                    <SelectContent>
                      {LEAD_STATUSES.map((status) => (
                        <SelectItem key={status} value={status}>
                          {LEAD_STATUS_LABELS[status]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-1">
                  <p className="text-xs font-medium text-muted-foreground">
                    Recommended next action
                  </p>
                  <p className="text-sm leading-6">
                    {detailLead.recommendedAction}
                  </p>
                </div>
                <div className="space-y-1">
                  <p className="text-xs font-medium text-muted-foreground">
                    Evidence
                  </p>
                  <p className="text-sm leading-6">{detailLead.evidence}</p>
                </div>
              </div>
            </>
          ) : null}
        </SheetContent>
      </Sheet>

      {/* Add / edit lead */}
      <Dialog
        open={addOpen}
        onOpenChange={(open) => {
          setAddOpen(open);
          if (!open) setEditingId(null);
        }}
      >
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{editingId ? "Edit lead" : "Add lead"}</DialogTitle>
            <DialogDescription>
              {editingId
                ? "Updates this lead in the browser session."
                : "Adds a demo lead to this browser session."}
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleSubmit} noValidate className="grid gap-4 sm:grid-cols-2">
            <FormField label="Company" required error={errors.company}>
              {(p) => (
                <Input
                  {...p}
                  placeholder="Apex Indoor Golf"
                  value={form.company}
                  onChange={(e) => setField("company", e.target.value)}
                />
              )}
            </FormField>
            <FormField label="Contact" required error={errors.contact}>
              {(p) => (
                <Input
                  {...p}
                  placeholder="Marcus Hale"
                  value={form.contact}
                  onChange={(e) => setField("contact", e.target.value)}
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
            <FormField label="Phone" error={errors.phone}>
              {(p) => (
                <Input
                  {...p}
                  placeholder="+1 303 555 0142"
                  value={form.phone}
                  onChange={(e) => setField("phone", e.target.value)}
                />
              )}
            </FormField>
            <FormField label="Estimated value (USD)" required error={errors.value}>
              {(p) => (
                <Input
                  {...p}
                  type="number"
                  min={0}
                  step={1000}
                  placeholder="25000"
                  value={form.value}
                  onChange={(e) => setField("value", e.target.value)}
                />
              )}
            </FormField>
            <FormField label="Next follow-up" required error={errors.nextFollowUp}>
              {(p) => (
                <Input
                  {...p}
                  type="date"
                  value={form.nextFollowUp}
                  onChange={(e) => setField("nextFollowUp", e.target.value)}
                />
              )}
            </FormField>
            <FormField label="Business type" required>
              {(p) => (
                <Select
                  value={form.businessType}
                  onValueChange={(v) =>
                    setField("businessType", v as BusinessType)
                  }
                >
                  <SelectTrigger
                    className="w-full"
                    {...p}
                    aria-label="Business type"
                  >
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
            <FormField label="Source" required>
              {(p) => (
                <Select
                  value={form.source}
                  onValueChange={(v) => setField("source", v as LeadSource)}
                >
                  <SelectTrigger className="w-full" {...p} aria-label="Source">
                    {form.source}
                  </SelectTrigger>
                  <SelectContent>
                    {LEAD_SOURCES.map((source) => (
                      <SelectItem key={source} value={source}>
                        {source}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
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

            <details
              open={errors.score !== undefined || errors.fitScore !== undefined}
              className="group rounded-lg border border-border px-3.5 py-2.5 sm:col-span-2"
            >
              <summary className="flex cursor-pointer list-none items-center justify-between text-sm font-medium outline-none [&::-webkit-details-marker]:hidden focus-visible:ring-3 focus-visible:ring-ring/50">
                Scoring (optional)
                <ChevronDown
                  className="size-4 text-muted-foreground transition-transform group-open:rotate-180"
                  aria-hidden="true"
                />
              </summary>
              <div className="mt-3 grid gap-4 sm:grid-cols-2">
                <FormField label="Lead score (0-100)" error={errors.score}>
                  {(p) => (
                    <Input
                      {...p}
                      type="number"
                      min={0}
                      max={100}
                      value={form.score}
                      onChange={(e) => setField("score", e.target.value)}
                    />
                  )}
                </FormField>
                <FormField label="Business-fit score (0-100)" error={errors.fitScore}>
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
              </div>
            </details>

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
              <Button type="submit">{editingId ? "Save changes" : "Add lead"}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
        title="Delete lead?"
        description={
          deleteTarget
            ? `"${deleteTarget.company}" will be removed from this browser session. This cannot be undone.`
            : ""
        }
        onConfirm={confirmDelete}
      />

      {/* CSV import report */}
      <Dialog
        open={importResult !== null}
        onOpenChange={(open) => {
          if (!open) setImportResult(null);
        }}
      >
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Import report</DialogTitle>
            <DialogDescription>
              {importResult
                ? `${importResult.valid.length} of ${importResult.rows.length} rows are ready to import.`
                : ""}
            </DialogDescription>
          </DialogHeader>
          {importResult ? (
            <div className="space-y-4">
              {importResult.failed.length > 0 ? (
                <div className="space-y-2">
                  <p className="text-sm font-medium text-destructive">
                    {importResult.failed.length} row
                    {importResult.failed.length === 1 ? "" : "s"} will be skipped
                  </p>
                  <ul className="space-y-1.5 rounded-lg border border-border p-3">
                    {importResult.failed.map((row) => (
                      <li key={row.line} className="text-xs">
                        <span className="font-medium tabular-nums">
                          Line {row.line}:
                        </span>{" "}
                        {row.errors.join(" ")}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
              {importResult.valid.length > 0 ? (
                <div>
                  <p className="text-sm font-medium">
                    {importResult.valid.length} row
                    {importResult.valid.length === 1 ? "" : "s"} will be imported
                  </p>
                  <ul className="mt-1.5 max-h-40 space-y-1 overflow-y-auto text-xs text-muted-foreground">
                    {importResult.valid.map((row) => (
                      <li key={row.line} className="tabular-nums">
                        Line {row.line}: {row.lead?.company} — {row.lead?.contact}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
              <DialogFooter>
                <Button
                  variant="outline"
                  onClick={() => setImportResult(null)}
                >
                  Cancel
                </Button>
                <Button
                  onClick={confirmImport}
                  disabled={importResult.valid.length === 0}
                >
                  Import {importResult.valid.length} row
                  {importResult.valid.length === 1 ? "" : "s"}
                </Button>
              </DialogFooter>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </motion.div>
  );
}
