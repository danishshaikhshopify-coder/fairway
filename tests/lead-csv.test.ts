import assert from "node:assert/strict";
import test from "node:test";
import {
  importLeadsCsv,
  leadsToCsv,
  parseCsvLine,
  LEAD_CSV_HEADERS,
} from "../src/lib/lead-csv.ts";
import type { Lead } from "../src/lib/types.ts";

const HEADER = LEAD_CSV_HEADERS.join(",");
const validRow = (over: Partial<Record<string, string>> = {}) =>
  [
    over.company ?? "Summit Golf Barn",
    over.contact ?? "Rae Kim",
    over.email ?? "rae@summit.example",
    over.phone ?? "+1 555 0100",
    over.source ?? "Website",
    over.businessType ?? "Commercial",
    over.value ?? "42000",
    over.score ?? "77",
    over.fitScore ?? "80",
    over.owner ?? "J. Chen",
    over.nextFollowUp ?? "2026-11-30",
  ].join(",");

test("parseCsvLine handles quotes, escaped quotes and embedded commas", () => {
  assert.deepEqual(parseCsvLine('a,"b,c","say ""hi""",d'), [
    "a",
    "b,c",
    'say "hi"',
    "d",
  ]);
});

test("export then import round-trips every lead", () => {
  const leads = [
    {
      id: "csv-1",
      company: "Comma, Inc",
      contact: 'The "Quote" Guy',
      email: "x@y.example",
      phone: "",
      source: "Referral",
      status: "new",
      score: 60,
      fitScore: 65,
      businessType: "Both",
      value: 1000,
      owner: "A. Rivera",
      lastContact: "2026-10-24",
      nextFollowUp: "",
      evidence: "",
      followUpEvidence: "",
      qualification: "Pending",
      recommendedAction: "",
    },
  ] satisfies Lead[];

  const csv = leadsToCsv(leads);
  const result = importLeadsCsv(csv, []);
  assert.equal(result.fatal.length, 0);
  assert.equal(result.valid.length, 1);
  assert.equal(result.failed.length, 0);
  const lead = result.valid[0].lead!;
  assert.equal(lead.company, "Comma, Inc");
  assert.equal(lead.contact, 'The "Quote" Guy');
  assert.equal(lead.value, 1000);
});

test("missing required header is a fatal file error", () => {
  const result = importLeadsCsv("company,contact\nA,B\n", []);
  assert.equal(result.fatal.length, 1);
  assert.match(result.fatal[0], /Missing required column.*value/);
  assert.equal(result.rows.length, 0);
});

test("empty file is fatal", () => {
  const result = importLeadsCsv("   \r\n  \n", []);
  assert.match(result.fatal[0], /empty/i);
});

test("invalid rows are reported per line with reasons", () => {
  const csv = [
    HEADER,
    validRow({ email: "not-an-email" }),
    validRow({ value: "-5" }),
    validRow({ score: "150" }),
    validRow({ company: "" }),
  ].join("\n");
  const result = importLeadsCsv(csv, []);
  assert.equal(result.fatal.length, 0);
  assert.equal(result.valid.length, 0);
  assert.equal(result.failed.length, 4);
  assert.equal(result.failed[0].line, 2);
  assert.match(result.failed[0].errors.join(" "), /valid email/);
  assert.match(result.failed[1].errors.join(" "), /value in USD/);
  assert.match(result.failed[2].errors.join(" "), /0-100/);
  assert.match(result.failed[3].errors.join(" "), /Company is required/);
});

test("duplicate against existing leads is rejected", () => {
  const csv = [HEADER, validRow()].join("\n");
  const result = importLeadsCsv(csv, [
    { email: "RAE@summit.example", company: " summit golf barn " },
  ]);
  assert.equal(result.valid.length, 0);
  assert.match(result.failed[0].errors.join(" "), /already exists/);
});

test("duplicate within the same file is rejected", () => {
  const csv = [HEADER, validRow(), validRow()].join("\n");
  const result = importLeadsCsv(csv, []);
  assert.equal(result.valid.length, 1);
  assert.equal(result.failed.length, 1);
  assert.match(result.failed[0].errors.join(" "), /earlier in the file/);
});

test("optional score/source columns default when absent", () => {
  const csv = ["company,contact,email,value", "A Co,Pat,pat@a.example,5000"].join(
    "\n",
  );
  const result = importLeadsCsv(csv, []);
  assert.equal(result.valid.length, 1);
  const lead = result.valid[0].lead!;
  assert.equal(lead.score, 50);
  assert.equal(lead.source, "Cold call");
  assert.equal(lead.businessType, "Both");
  assert.equal(lead.status, "new");
});

test("unknown source label is rejected", () => {
  const csv = [HEADER, validRow({ source: "Pigeon post" })].join("\n");
  const result = importLeadsCsv(csv, []);
  assert.match(result.failed[0].errors.join(" "), /Unknown source/);
});
