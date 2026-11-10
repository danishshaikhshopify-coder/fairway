import assert from "node:assert/strict";
import test from "node:test";
import {
  addDaysIso,
  computeNextStep,
  isEligibleForCadence,
  validateCadenceSteps,
  type CadenceStepConfig,
} from "../src/lib/cadence/engine.ts";

const STEPS: CadenceStepConfig[] = [
  { stepNumber: 1, intervalDays: 3, channel: "call" },
  { stepNumber: 2, intervalDays: 4, channel: "email" },
  { stepNumber: 3, intervalDays: 6, channel: "linkedin" },
  { stepNumber: 4, intervalDays: 7, channel: "whatsapp" },
];

test("addDaysIso adds calendar days, crossing month and year boundaries", () => {
  assert.equal(addDaysIso("2026-11-09", 3), "2026-11-12");
  assert.equal(addDaysIso("2026-11-28", 4), "2026-12-02");
  assert.equal(addDaysIso("2026-12-29", 7), "2027-01-05");
});

test("computeNextStep returns step 1 due dates anchored off the given date", () => {
  const next = computeNextStep(STEPS, 0, "2026-11-09");
  assert.deepEqual(next, { stepNumber: 1, dueDate: "2026-11-12", channel: "call" });
});

test("computeNextStep chains off the previous step's own due date, not the original anchor", () => {
  const next = computeNextStep(STEPS, 1, "2026-11-12");
  assert.deepEqual(next, { stepNumber: 2, dueDate: "2026-11-16", channel: "email" });
});

test("computeNextStep returns null once the cadence is exhausted", () => {
  assert.equal(computeNextStep(STEPS, 4, "2026-11-09"), null);
});

test("computeNextStep returns null with no anchor date", () => {
  assert.equal(computeNextStep(STEPS, 0, ""), null);
});

test("isEligibleForCadence excludes paused leads and closed deals", () => {
  assert.equal(isEligibleForCadence({ status: "qualified", cadencePaused: false }), true);
  assert.equal(isEligibleForCadence({ status: "qualified", cadencePaused: true }), false);
  assert.equal(isEligibleForCadence({ status: "won", cadencePaused: false }), false);
  assert.equal(isEligibleForCadence({ status: "lost", cadencePaused: false }), false);
});

test("validateCadenceSteps accepts a well-formed list and sorts it", () => {
  const result = validateCadenceSteps([
    { stepNumber: 2, intervalDays: 4, channel: "email" },
    { stepNumber: 1, intervalDays: 3, channel: "call" },
  ]);
  assert.deepEqual(result, [
    { stepNumber: 1, intervalDays: 3, channel: "call" },
    { stepNumber: 2, intervalDays: 4, channel: "email" },
  ]);
});

test("validateCadenceSteps rejects duplicate step numbers", () => {
  assert.equal(
    validateCadenceSteps([
      { stepNumber: 1, intervalDays: 3, channel: "call" },
      { stepNumber: 1, intervalDays: 4, channel: "email" },
    ]),
    null,
  );
});

test("validateCadenceSteps rejects an unknown channel", () => {
  assert.equal(validateCadenceSteps([{ stepNumber: 1, intervalDays: 3, channel: "sms" }]), null);
});

test("validateCadenceSteps rejects a non-positive interval", () => {
  assert.equal(validateCadenceSteps([{ stepNumber: 1, intervalDays: 0, channel: "call" }]), null);
});

test("validateCadenceSteps rejects non-array input", () => {
  assert.equal(validateCadenceSteps({ stepNumber: 1 }), null);
});
