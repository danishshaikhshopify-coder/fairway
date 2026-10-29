"use client";

// CRM state. Two modes behind ONE interface:
//
//   demo (default) — mock data seeds React state; nothing persists.
//   live           — enabled only when NEXT_PUBLIC_SUPABASE_URL and
//                    NEXT_PUBLIC_SUPABASE_ANON_KEY are both set (see
//                    src/lib/supabase/client.ts). State still drives every
//                    render, but it is hydrated from Supabase once a session
//                    exists and every mutation is mirrored to the database.
//
// Reads are optimistic: a mutation updates local state immediately, then
// persists in the background. A failed write logs to the console and leaves
// the UI showing the change that did not land; see the note on `persist`.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  MOCK_ACTIVITIES,
  MOCK_COMPANIES,
  MOCK_CONTACTS,
  MOCK_LEADS,
  MOCK_TASKS,
} from "@/lib/mock-data";
import { todayIso } from "@/lib/format";
import type {
  Activity,
  Company,
  Contact,
  Lead,
  LeadStatus,
  Task,
} from "@/lib/types";
import { getSupabase, isLiveMode } from "@/lib/supabase/client";
import { useAuth } from "@/lib/auth-context";
import {
  insertActivity,
  insertCompany,
  insertContact,
  insertLead,
  insertTask,
  loadActivities,
  loadCompanies,
  loadContacts,
  loadLeads,
  loadTasks,
  loadWorkspaceContext,
  moveLead as moveLeadRow,
  removeRow,
  setTaskDone,
  updateCompany as updateCompanyRow,
  updateContact as updateContactRow,
  updateLead as updateLeadRow,
  type WorkspaceContext,
} from "@/lib/supabase/repository";

export type New<T> = Omit<T, "id">;

interface CrmContextValue {
  leads: Lead[];
  companies: Company[];
  contacts: Contact[];
  tasks: Task[];
  activities: Activity[];
  /** true while a live-mode first load is in flight. */
  loading: boolean;
  addLead: (lead: New<Lead>) => void;
  addCompany: (company: New<Company>) => void;
  addContact: (contact: New<Contact>) => void;
  addTask: (task: New<Task>) => void;
  addActivity: (activity: New<Activity>) => void;
  updateLead: (id: string, patch: Partial<Lead>) => void;
  updateCompany: (id: string, patch: Partial<Company>) => void;
  updateContact: (id: string, patch: Partial<Contact>) => void;
  moveLead: (id: string, status: LeadStatus) => void;
  setLeadStatuses: (ids: string[], status: LeadStatus) => void;
  toggleTask: (id: string) => void;
  removeLead: (id: string) => void;
  removeCompany: (id: string) => void;
  removeContact: (id: string) => void;
  removeTask: (id: string) => void;
  removeActivity: (id: string) => void;
}

const CrmContext = createContext<CrmContextValue | null>(null);

function newId(): string {
  return crypto.randomUUID();
}

type DeletableTable =
  | "leads"
  | "companies"
  | "contacts"
  | "tasks"
  | "activities";

/** No-op resolve in demo mode; a real DELETE when a Supabase client exists. */
function removeIfLive(table: DeletableTable, id: string): Promise<void> {
  const db = getSupabase();
  return db ? removeRow(db, table, id) : Promise.resolve();
}

export function CrmProvider({ children }: { children: ReactNode }) {
  // Demo mode keeps the fixtures; live mode starts empty so a signed-in user
  // can never see the demo rows (or a previous session's rows) flash by before
  // the workspace fetch lands.
  const [leads, setLeads] = useState<Lead[]>(() => (isLiveMode() ? [] : MOCK_LEADS));
  const [companies, setCompanies] = useState<Company[]>(() =>
    isLiveMode() ? [] : MOCK_COMPANIES,
  );
  const [contacts, setContacts] = useState<Contact[]>(() =>
    isLiveMode() ? [] : MOCK_CONTACTS,
  );
  const [tasks, setTasks] = useState<Task[]>(() => (isLiveMode() ? [] : MOCK_TASKS));
  const [activities, setActivities] = useState<Activity[]>(() =>
    isLiveMode() ? [] : MOCK_ACTIVITIES,
  );
  // Seeded from the mode rather than set inside the effect: in live mode the
  // first render is genuinely "loading" (state is still empty until the fetch
  // lands), in demo mode there is never a load at all.
  const [loading, setLoading] = useState(() => isLiveMode());

  // The fetch is keyed to the session, not to mount: it must not run before
  // Supabase can vouch for a caller, and it must re-run for whoever signs in
  // next. Outside a provider this is the demo-mode default, so nothing changes
  // for the env-less build.
  const { session } = useAuth();

  // Live-mode context (workspace id + owner/source lookup tables). Null in
  // demo mode, and until the first load finishes in live mode.
  const ctxRef = useRef<WorkspaceContext | null>(null);

  // Live mode only: hydrate from Supabase, replacing the (empty) seed.
  // Deliberately skipped entirely in demo mode so the env-less app never
  // constructs a client or issues a query. Switching accounts is handled by
  // CrmSession re-keying this provider, so a new session always starts from a
  // fresh mount instead of from the previous user's rows.
  useEffect(() => {
    if (!isLiveMode() || !session) return;
    const db = getSupabase();
    if (!db) return;
    let cancelled = false;
    (async () => {
      try {
        const ctx = await loadWorkspaceContext(db);
        const [l, c, ct, t, a] = await Promise.all([
          loadLeads(db),
          loadCompanies(db),
          loadContacts(db),
          loadTasks(db),
          loadActivities(db),
        ]);
        if (cancelled) return;
        ctxRef.current = ctx;
        setLeads(l);
        setCompanies(c);
        setContacts(ct);
        setTasks(t);
        setActivities(a);
      } catch (err) {
        // Leave the CRM empty rather than showing demo rows the user could try
        // to edit, and make the cause visible in the console.
        console.error("[crm] live load failed, leaving the CRM empty", err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [session]);

  // Background persist helper. Never throws into the UI: the optimistic
  // state update above already happened, so a failed write is logged and the
  // caller can retry. ponytail: no rollback/refetch-on-error yet — add when
  // concurrent editing makes stale rows a real problem.
  const persist = useCallback((label: string, run: () => Promise<unknown>) => {
    if (!isLiveMode()) return;
    run().catch((err) => console.error(`[crm] ${label} failed`, err));
  }, []);

  const addLead = useCallback((lead: New<Lead>) => {
    const id = newId();
    setLeads((prev) => [{ ...lead, id }, ...prev]);
    persist("addLead", async () => {
      const db = getSupabase();
      const ctx = ctxRef.current;
      if (!db || !ctx) return;
      const saved = await insertLead(db, ctx, lead);
      setLeads((prev) => prev.map((l) => (l.id === id ? saved : l)));
    });
  }, [persist]);

  const addCompany = useCallback((company: New<Company>) => {
    const id = newId();
    setCompanies((prev) => [{ ...company, id }, ...prev]);
    persist("addCompany", async () => {
      const db = getSupabase();
      const ctx = ctxRef.current;
      if (!db || !ctx) return;
      const saved = await insertCompany(db, ctx, company);
      setCompanies((prev) => prev.map((c) => (c.id === id ? saved : c)));
    });
  }, [persist]);

  const addContact = useCallback((contact: New<Contact>) => {
    const id = newId();
    setContacts((prev) => [{ ...contact, id }, ...prev]);
    persist("addContact", async () => {
      const db = getSupabase();
      const ctx = ctxRef.current;
      if (!db || !ctx) return;
      const companyIds = new Map(companies.map((c) => [c.name, c.id]));
      const saved = await insertContact(db, ctx, contact, companyIds);
      setContacts((prev) => prev.map((c) => (c.id === id ? saved : c)));
    });
  }, [persist, companies]);

  const addTask = useCallback((task: New<Task>) => {
    const id = newId();
    setTasks((prev) => [{ ...task, id }, ...prev]);
    persist("addTask", async () => {
      const db = getSupabase();
      const ctx = ctxRef.current;
      if (!db || !ctx) return;
      const saved = await insertTask(db, ctx, task);
      setTasks((prev) => prev.map((t) => (t.id === id ? saved : t)));
    });
  }, [persist]);

  const addActivity = useCallback((activity: New<Activity>) => {
    const id = newId();
    setActivities((prev) => [{ ...activity, id }, ...prev]);
    persist("addActivity", async () => {
      const db = getSupabase();
      const ctx = ctxRef.current;
      if (!db || !ctx) return;
      const saved = await insertActivity(db, ctx, activity);
      setActivities((prev) => prev.map((a) => (a.id === id ? saved : a)));
    });
  }, [persist]);

  const updateLead = useCallback((id: string, patch: Partial<Lead>) => {
    setLeads((prev) => prev.map((l) => (l.id === id ? { ...l, ...patch } : l)));
    persist("updateLead", () => {
      const db = getSupabase();
      const ctx = ctxRef.current;
      return db && ctx ? updateLeadRow(db, ctx, id, patch) : Promise.resolve();
    });
  }, [persist]);

  const updateCompany = useCallback((id: string, patch: Partial<Company>) => {
    setCompanies((prev) => prev.map((c) => (c.id === id ? { ...c, ...patch } : c)));
    persist("updateCompany", () => {
      const db = getSupabase();
      const ctx = ctxRef.current;
      return db && ctx ? updateCompanyRow(db, ctx, id, patch) : Promise.resolve();
    });
  }, [persist]);

  const updateContact = useCallback((id: string, patch: Partial<Contact>) => {
    setContacts((prev) => prev.map((c) => (c.id === id ? { ...c, ...patch } : c)));
    persist("updateContact", () => {
      const db = getSupabase();
      const ctx = ctxRef.current;
      if (!db || !ctx) return Promise.resolve();
      const companyIds = new Map(companies.map((c) => [c.name, c.id]));
      return updateContactRow(db, ctx, id, patch, companyIds);
    });
  }, [persist, companies]);

  const moveLead = useCallback((id: string, status: LeadStatus) => {
    const bumped = todayIso();
    setLeads((prev) =>
      prev.map((l) =>
        l.id === id
          ? { ...l, status, lastContact: status === l.status ? l.lastContact : bumped }
          : l,
      ),
    );
    persist("moveLead", () => {
      const db = getSupabase();
      return db ? moveLeadRow(db, id, status, bumped) : Promise.resolve();
    });
  }, [persist]);

  const setLeadStatuses = useCallback((ids: string[], status: LeadStatus) => {
    const idSet = new Set(ids);
    setLeads((prev) =>
      prev.map((l) => (idSet.has(l.id) ? { ...l, status } : l)),
    );
    persist("setLeadStatuses", () => {
      const db = getSupabase();
      if (!db) return Promise.resolve();
      return Promise.all(ids.map((id) => moveLeadRow(db, id, status, ""))).then(
        () => undefined,
      );
    });
  }, [persist]);

  const toggleTask = useCallback((id: string) => {
    let nowDone = false;
    setTasks((prev) =>
      prev.map((t) => {
        if (t.id !== id) return t;
        nowDone = !t.done;
        return { ...t, done: nowDone };
      }),
    );
    persist("toggleTask", () => {
      const db = getSupabase();
      return db ? setTaskDone(db, id, nowDone) : Promise.resolve();
    });
  }, [persist]);

  const removeLead = useCallback((id: string) => {
    setLeads((prev) => prev.filter((l) => l.id !== id));
    persist("removeLead", () => removeIfLive("leads", id));
  }, [persist]);
  const removeCompany = useCallback((id: string) => {
    setCompanies((prev) => prev.filter((c) => c.id !== id));
    persist("removeCompany", () => removeIfLive("companies", id));
  }, [persist]);

  const removeContact = useCallback((id: string) => {
    setContacts((prev) => prev.filter((c) => c.id !== id));
    persist("removeContact", () => removeIfLive("contacts", id));
  }, [persist]);

  const removeTask = useCallback((id: string) => {
    setTasks((prev) => prev.filter((t) => t.id !== id));
    persist("removeTask", () => removeIfLive("tasks", id));
  }, [persist]);

  const removeActivity = useCallback((id: string) => {
    setActivities((prev) => prev.filter((a) => a.id !== id));
    persist("removeActivity", () => removeIfLive("activities", id));
  }, [persist]);

  const value = useMemo<CrmContextValue>(
    () => ({
      leads,
      companies,
      contacts,
      tasks,
      activities,
      loading,
      addLead,
      addCompany,
      addContact,
      addTask,
      addActivity,
      updateLead,
      updateCompany,
      updateContact,
      moveLead,
      setLeadStatuses,
      toggleTask,
      removeLead,
      removeCompany,
      removeContact,
      removeTask,
      removeActivity,
    }),
    [
      leads,
      companies,
      contacts,
      tasks,
      activities,
      loading,
      addLead,
      addCompany,
      addContact,
      addTask,
      addActivity,
      updateLead,
      updateCompany,
      updateContact,
      moveLead,
      setLeadStatuses,
      toggleTask,
      removeLead,
      removeCompany,
      removeContact,
      removeTask,
      removeActivity,
    ],
  );

  return <CrmContext.Provider value={value}>{children}</CrmContext.Provider>;
}

export function useCrm(): CrmContextValue {
  const ctx = useContext(CrmContext);
  if (!ctx) throw new Error("useCrm must be used inside <CrmProvider>");
  return ctx;
}
