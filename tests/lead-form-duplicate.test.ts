import assert from "node:assert/strict";
import test from "node:test";
import { findDuplicateLead } from "../src/lib/lead-form.ts";

const leads = [
  { email: "jane@venue.example", company: "Pine Ridge Golf" },
  { email: "sam@other.example", company: "Desert Links" },
  { email: "jane@venue.example", company: "Metro Golf Co" },
];

test("matches exact duplicate: same email and company", () => {
  const dup = findDuplicateLead(leads, {
    email: "jane@venue.example",
    company: "Pine Ridge Golf",
  });
  assert.equal(dup?.company, "Pine Ridge Golf");
});

test("match is case- and whitespace-insensitive", () => {
  const dup = findDuplicateLead(leads, {
    email: "  JANE@Venue.Example ",
    company: " pine ridge golf ",
  });
  assert.equal(dup?.company, "Pine Ridge Golf");
});

test("same email, different company is allowed (multiple deals)", () => {
  const dup = findDuplicateLead(leads, {
    email: "jane@venue.example",
    company: "Skyline Indoor Golf",
  });
  assert.equal(dup, undefined);
});

test("same company, different email is allowed", () => {
  const dup = findDuplicateLead(leads, {
    email: "other@venue.example",
    company: "Desert Links",
  });
  assert.equal(dup, undefined);
});

test("empty email or company never matches", () => {
  assert.equal(
    findDuplicateLead(leads, { email: "", company: "Pine Ridge Golf" }),
    undefined,
  );
  assert.equal(
    findDuplicateLead(leads, { email: "jane@venue.example", company: "  " }),
    undefined,
  );
});

test("empty list never matches", () => {
  assert.equal(
    findDuplicateLead([], { email: "jane@venue.example", company: "Any Co" }),
    undefined,
  );
});
