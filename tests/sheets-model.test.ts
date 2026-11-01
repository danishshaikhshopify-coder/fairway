import assert from "node:assert/strict";
import test from "node:test";
import {
  buildSyncPlan,
  companyKey,
  contactKey,
  detectHeader,
  leadKey,
  mapRows,
  normaliseKey,
  type ExistingSnapshot,
} from "../src/lib/integrations/sheets/model.ts";

const HEADER = [
  "Client Abondant",
  "Perfect Client",
  "Insta",
  "Facebook",
  "LinkedIn",
  "Owner Name",
  "Owner LinkedIn",
  "Owner Instagram",
  "Owner Facebook",
  "Owner Phone Number",
  "Owner Email",
  "Business Email",
  "Client Insight",
];

test("detectHeader finds the header row when a banner row sits above it", () => {
  const values = [
    ["CRM SYSTEM — do not edit"],
    HEADER,
    ["Apex Indoor Golf", "", "", "", "", "Dana Reyes", "", "", "", "", "dana@apex.example", "", ""],
  ];
  const result = detectHeader(values);
  assert.ok(!("error" in result));
  if ("error" in result) return;
  assert.equal(result.headerRow, 1);
  assert.equal(result.columns.fields.company, 0);
});

test("detectHeader fails clearly when no row has a company column", () => {
  const result = detectHeader([["Random", "Noise"], ["a", "b"]]);
  assert.ok("error" in result);
});

test("mapRows maps socials, perfect client and insights from the real sheet header", () => {
  const values = [
    HEADER,
    [
      "Apex Indoor Golf",
      "lookalike.example",
      "ig.com/apex",
      "fb.com/apex",
      "",
      "Dana Reyes",
      "linkedin.com/in/dana",
      "@dana",
      "",
      "+1 303 555 0142",
      "dana@apex.example",
      "biz@apex.example",
      "High install volume, two bays.",
    ],
  ];
  const result = mapRows(values);
  assert.ok(!("error" in result));
  if ("error" in result) return;
  assert.equal(result.rows.length, 1);
  const row = result.rows[0];
  assert.equal(row.company.name, "Apex Indoor Golf");
  assert.equal(row.company.perfectClientUrl, "https://lookalike.example");
  assert.equal(row.company.instagramUrl, "https://ig.com/apex");
  assert.equal(row.company.facebookUrl, "https://fb.com/apex");
  assert.equal(row.company.notes, "High install volume, two bays.");
  assert.equal(row.contact?.name, "Dana Reyes");
  assert.equal(row.contact?.linkedinUrl, "https://linkedin.com/in/dana");
  assert.equal(row.contact?.instagramUrl, "https://instagram.com/dana");
  // "Owner Email" and "Business Email" map to separate CRM records.
  assert.equal(row.company.email, "biz@apex.example");
  assert.equal(row.contact?.email, "dana@apex.example");
});

test("a row with no company name is reported invalid, not silently dropped", () => {
  const values = [HEADER, ["", "", "", "", "", "Dana Reyes", "", "", "", "", "dana@apex.example", "", ""]];
  const result = mapRows(values);
  assert.ok(!("error" in result));
  if ("error" in result) return;
  assert.equal(result.rows.length, 0);
  assert.equal(result.invalid.length, 1);
  assert.match(result.invalid[0].errors[0], /company name/i);
});

test("a fully blank row is counted, not treated as invalid", () => {
  const values = [HEADER, ["", "", "", "", "", "", "", "", "", "", "", "", ""]];
  const result = mapRows(values);
  assert.ok(!("error" in result));
  if ("error" in result) return;
  assert.equal(result.blankRows, 1);
  assert.equal(result.invalid.length, 0);
});

test("stable keys are case/punctuation/order independent (survive sorting)", () => {
  assert.equal(companyKey("Apex Indoor Golf"), companyKey("  apex   indoor-golf  "));
  assert.equal(normaliseKey("Apex, Indoor Golf!"), normaliseKey("apex indoor golf"));
  const a = contactKey({ name: "Dana", email: "Dana@Apex.example" } as never, "Apex");
  const b = contactKey({ name: "Dana", email: "dana@apex.example" } as never, "Apex");
  assert.equal(a, b);
});

test("leadKey prefers email+company over contact name+company", () => {
  const withEmail = leadKey({ email: "dana@apex.example", company: "Apex", contact: "D. Reyes" } as never);
  const withEmail2 = leadKey({ email: "dana@apex.example", company: "Apex", contact: "Dana Reyes" } as never);
  assert.equal(withEmail, withEmail2);
});

test("buildSyncPlan: new rows create, matched rows update, row-internal dupes skip", () => {
  const values = [
    HEADER,
    ["Apex Indoor Golf", "", "", "", "", "Dana Reyes", "", "", "", "", "dana@apex.example", "", ""],
    ["Baja Golf Studio", "", "", "", "", "", "", "", "", "", "", "", ""],
    // Duplicate of row 2 (same company+contact email) — must not double-create.
    ["Apex Indoor Golf", "", "", "", "", "Dana Reyes", "", "", "", "", "dana@apex.example", "", ""],
  ];
  const mapped = mapRows(values);
  assert.ok(!("error" in mapped));
  if ("error" in mapped) return;

  const existing: ExistingSnapshot = {
    companies: [{ id: "co-1", name: "Baja Golf Studio" }],
    contacts: [],
    leads: [],
  };
  const plan = buildSyncPlan(mapped, existing);

  assert.equal(plan.counts.companies.create, 1, "Apex is new");
  assert.equal(plan.counts.companies.update, 1, "Baja matches by name");
  assert.equal(plan.rows[2].company.action, "skip", "second Apex row is a duplicate within the sheet");
  assert.ok(plan.duplicates.length > 0);
});

test("buildSyncPlan matches an existing record by sync_key even if its name changed", () => {
  const values = [HEADER, ["Apex Golf Renamed", "", "", "", "", "", "", "", "", "", "", "", ""]];
  const mapped = mapRows(values);
  assert.ok(!("error" in mapped));
  if ("error" in mapped) return;

  const existing: ExistingSnapshot = {
    companies: [{ id: "co-1", name: "Apex Indoor Golf", sync_key: companyKey("Apex Golf Renamed") }],
    contacts: [],
    leads: [],
  };
  const plan = buildSyncPlan(mapped, existing);
  assert.equal(plan.rows[0].company.action, "update");
  assert.equal(plan.rows[0].company.matchId, "co-1");
});
