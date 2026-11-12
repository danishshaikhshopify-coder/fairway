// Remove-member authorization rules — pure logic the API route delegates
// to. No DOM, no network: `node --test` runs this directly against the
// source.
import assert from "node:assert/strict";
import test from "node:test";
import { canRemoveMember } from "../src/lib/team/invites.ts";

test("the owner can never be removed, regardless of who is acting", () => {
  const result = canRemoveMember({ id: "owner-1", role: "owner" }, "acting-member-1");
  assert.equal(result.ok, false);
});

test("a caller can never remove their own membership", () => {
  const result = canRemoveMember({ id: "member-1", role: "admin" }, "member-1");
  assert.equal(result.ok, false);
});

test("the owner removing a different, non-owner member is allowed", () => {
  const result = canRemoveMember({ id: "member-2", role: "sales_rep" }, "owner-1");
  assert.equal(result.ok, true);
});

test("every invitable role other than owner is removable by someone else", () => {
  for (const role of ["admin", "sales_rep", "viewer"]) {
    assert.equal(canRemoveMember({ id: "member-3", role }, "owner-1").ok, true);
  }
});
