import assert from "node:assert/strict";
import test from "node:test";
import { generateNextFollowUp, type LeadCadenceState } from "../src/lib/cadence/generate.ts";
import type { CadenceStepConfig } from "../src/lib/cadence/engine.ts";
import type { SupabaseClient } from "@supabase/supabase-js";

const STEPS: CadenceStepConfig[] = [
  { stepNumber: 1, intervalDays: 3, channel: "call" },
  { stepNumber: 2, intervalDays: 4, channel: "email" },
];

interface FakeTaskRow {
  id: string;
  lead_id: string;
  cadence_step: number;
  title: string;
  due_date: string;
  priority: string;
  type: string;
  is_done: boolean;
  related_to: string;
  cancelled_at: string | null;
}

/**
 * Minimal stand-in for the chainable Supabase query builder, covering only
 * the exact call shapes generateNextFollowUp makes against `tasks`/`leads`:
 * .select().eq().eq().maybeSingle(), .insert().select().single(), and a bare
 * .update().eq() awaited directly (PromiseLike, like the real builder).
 */
function makeFakeDb(
  tasks: FakeTaskRow[],
  leadUpdates: Record<string, unknown>[],
  options: { simulateDedupeRace?: boolean } = {},
): SupabaseClient {
  function from(table: string) {
    const filters: Record<string, unknown> = {};
    let insertPayload: Record<string, unknown> | null = null;
    let updatePayload: Record<string, unknown> | null = null;
    const api = {
      select() {
        return api;
      },
      eq(col: string, val: unknown) {
        filters[col] = val;
        return api;
      },
      insert(payload: Record<string, unknown>) {
        insertPayload = payload;
        return api;
      },
      update(payload: Record<string, unknown>) {
        updatePayload = payload;
        return api;
      },
      async maybeSingle() {
        if (table !== "tasks") return { data: null, error: null };
        if (options.simulateDedupeRace) return { data: null, error: null };
        const found = tasks.find(
          (t) => t.lead_id === filters.lead_id && t.cadence_step === filters.cadence_step,
        );
        return { data: found ? { id: found.id } : null, error: null };
      },
      async single() {
        if (table !== "tasks" || !insertPayload) return { data: null, error: null };
        const dup = tasks.find(
          (t) => t.lead_id === insertPayload!.lead_id && t.cadence_step === insertPayload!.cadence_step,
        );
        if (dup) return { data: null, error: { code: "23505", message: "duplicate key" } };
        const row: FakeTaskRow = {
          id: `task-${tasks.length + 1}`,
          lead_id: insertPayload.lead_id as string,
          cadence_step: insertPayload.cadence_step as number,
          title: insertPayload.title as string,
          due_date: insertPayload.due_date as string,
          priority: insertPayload.priority as string,
          type: insertPayload.type as string,
          is_done: false,
          related_to: insertPayload.related_to as string,
          cancelled_at: null,
        };
        tasks.push(row);
        return { data: row, error: null };
      },
      // Awaited directly with no terminal call — only the `leads` update does this here.
      then(resolve: (v: { data: null; error: null }) => void) {
        if (table === "leads" && updatePayload) {
          leadUpdates.push({ id: filters.id, ...updatePayload });
        }
        resolve({ data: null, error: null });
      },
    };
    return api;
  }
  return { from } as unknown as SupabaseClient;
}

function baseLead(overrides: Partial<LeadCadenceState> = {}): LeadCadenceState {
  return {
    id: "lead-1",
    companyName: "Acme Golf",
    status: "qualified",
    cadencePaused: false,
    cadenceStep: 0,
    cadenceAnchorDate: null,
    lastContact: null,
    createdAt: "2026-11-01T00:00:00.000Z",
    ...overrides,
  };
}

test("generateNextFollowUp bootstraps step 1 from last contact and advances the lead", async () => {
  const tasks: FakeTaskRow[] = [];
  const leadUpdates: Record<string, unknown>[] = [];
  const db = makeFakeDb(tasks, leadUpdates);

  const created = await generateNextFollowUp(db, "ws-1", baseLead({ lastContact: "2026-11-09" }), STEPS);

  assert.ok(created);
  assert.equal(created?.dueDate, "2026-11-12");
  assert.equal(created?.title, "Call follow-up — Acme Golf");
  assert.deepEqual(leadUpdates, [{ id: "lead-1", cadence_step: 1, cadence_anchor_date: "2026-11-12" }]);
});

test("generateNextFollowUp chains step 2 off the lead's own cadence anchor date", async () => {
  const tasks: FakeTaskRow[] = [];
  const leadUpdates: Record<string, unknown>[] = [];
  const db = makeFakeDb(tasks, leadUpdates);

  const created = await generateNextFollowUp(
    db,
    "ws-1",
    baseLead({ cadenceStep: 1, cadenceAnchorDate: "2026-11-12" }),
    STEPS,
  );

  assert.equal(created?.dueDate, "2026-11-16");
  assert.equal(created?.title, "Email follow-up — Acme Golf");
});

test("generateNextFollowUp returns null once the cadence is exhausted", async () => {
  const db = makeFakeDb([], []);
  const created = await generateNextFollowUp(
    db,
    "ws-1",
    baseLead({ cadenceStep: 2, cadenceAnchorDate: "2026-11-16" }),
    STEPS,
  );
  assert.equal(created, null);
});

test("generateNextFollowUp never generates for a paused lead", async () => {
  const db = makeFakeDb([], []);
  const created = await generateNextFollowUp(db, "ws-1", baseLead({ cadencePaused: true, lastContact: "2026-11-09" }), STEPS);
  assert.equal(created, null);
});

test("generateNextFollowUp never generates for a won or lost lead", async () => {
  const db = makeFakeDb([], []);
  for (const status of ["won", "lost"]) {
    const created = await generateNextFollowUp(db, "ws-1", baseLead({ status, lastContact: "2026-11-09" }), STEPS);
    assert.equal(created, null);
  }
});

test("generateNextFollowUp dedupes: a step already generated for this lead is not recreated", async () => {
  const tasks: FakeTaskRow[] = [
    {
      id: "task-existing",
      lead_id: "lead-1",
      cadence_step: 1,
      title: "Call follow-up — Acme Golf",
      due_date: "2026-11-12",
      priority: "medium",
      type: "follow-up",
      is_done: false,
      related_to: "Acme Golf",
      cancelled_at: null,
    },
  ];
  const leadUpdates: Record<string, unknown>[] = [];
  const db = makeFakeDb(tasks, leadUpdates);

  const created = await generateNextFollowUp(db, "ws-1", baseLead({ lastContact: "2026-11-09" }), STEPS);
  assert.equal(created, null);
  assert.equal(tasks.length, 1);
  assert.deepEqual(leadUpdates, []);
});

test("generateNextFollowUp treats a 23505 unique-violation race as already-generated, not an error", async () => {
  // Simulates two concurrent callers racing past the dedupe SELECT: the
  // maybeSingle() check is forced blind (simulateDedupeRace), but the
  // insert's own duplicate check — standing in for the DB's unique index —
  // still catches the row a concurrent request already created.
  const tasks: FakeTaskRow[] = [];
  const db = makeFakeDb(tasks, [], { simulateDedupeRace: true });
  tasks.push({
    id: "task-race",
    lead_id: "lead-1",
    cadence_step: 1,
    title: "Call follow-up — Acme Golf",
    due_date: "2026-11-12",
    priority: "medium",
    type: "follow-up",
    is_done: false,
    related_to: "Acme Golf",
    cancelled_at: null,
  });

  const created = await generateNextFollowUp(db, "ws-1", baseLead({ lastContact: "2026-11-09" }), STEPS);
  assert.equal(created, null);
});
