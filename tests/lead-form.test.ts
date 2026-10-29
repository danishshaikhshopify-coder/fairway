import assert from "node:assert/strict";
import { test } from "node:test";
import { validateLeadForm, type LeadForm } from "../src/lib/lead-form.ts";

/** A complete, submittable form. Each test overrides one field. */
function validForm(): LeadForm {
  return {
    company: "Apex Indoor Golf",
    contact: "Dana Reyes",
    email: "dana@apexgolf.com",
    phone: "555-0100",
    source: "Website",
    businessType: "Seller",
    value: "125000",
    score: "50",
    fitScore: "50",
    owner: "A. Rivera",
    nextFollowUp: "2026-11-01",
  };
}

function withField(patch: Partial<LeadForm>): LeadForm {
  return { ...validForm(), ...patch };
}

function errorFor(patch: Partial<LeadForm>): string | undefined {
  return validateLeadForm(withField(patch)).email;
}

// --- 2. Submitting with every field empty -------------------------------

test("empty form reports every required field", () => {
  const errors = validateLeadForm({
    ...validForm(),
    company: "",
    contact: "",
    email: "",
    value: "",
    nextFollowUp: "",
  });
  assert.deepEqual(Object.keys(errors).sort(), [
    "company",
    "contact",
    "email",
    "nextFollowUp",
    "value",
  ]);
  assert.equal(errors.company, "Company is required.");
  assert.equal(errors.contact, "Contact name is required.");
  assert.equal(errors.email, "Email is required.");
  assert.equal(errors.value, "Enter an estimated value in USD.");
  assert.equal(errors.nextFollowUp, "Pick a follow-up date.");
});

test("blank placeholders in required fields are still required", () => {
  const errors = validateLeadForm(withField({ company: "   ", contact: "\t" }));
  assert.equal(errors.company, "Company is required.");
  assert.equal(errors.contact, "Contact name is required.");
});

test("a valid form produces no errors", () => {
  assert.deepEqual(validateLeadForm(validForm()), {});
});

// --- 3. Invalid email ---------------------------------------------------

test("missing email is required, not merely invalid", () => {
  assert.equal(errorFor({ email: "" }), "Email is required.");
  assert.equal(errorFor({ email: "   " }), "Email is required.");
});

test("malformed emails are rejected", () => {
  for (const email of ["abc", "a@b", "@b.com", "a@@b.com", "a b@c.com", "a@ b.com"]) {
    assert.equal(errorFor({ email }), "Enter a valid email address.", `email: ${email}`);
  }
});

test("well-formed emails are accepted", () => {
  for (const email of ["a@b.co", "first.last+tag@sub.domain.io", "dana@apexgolf.com"]) {
    assert.equal(errorFor({ email }), undefined, `email: ${email}`);
  }
});

test("an invalid email does not suppress the other field errors", () => {
  const errors = validateLeadForm(withField({ email: "nope", company: "" }));
  assert.equal(errors.email, "Enter a valid email address.");
  assert.equal(errors.company, "Company is required.");
  assert.equal(errors.contact, undefined);
});

// --- Estimated value ----------------------------------------------------

test("non-numeric, negative and blank values are rejected", () => {
  for (const value of ["", "   ", "abc", "-5"]) {
    const errors = validateLeadForm(withField({ value }));
    assert.equal(errors.value, "Enter an estimated value in USD.", `value: ${JSON.stringify(value)}`);
  }
});

test("values that parse to a non-finite number are rejected", () => {
  for (const value of ["1e999", "-1e999", "Infinity"]) {
    const errors = validateLeadForm(withField({ value }));
    assert.equal(errors.value, "Enter an estimated value in USD.", `value: ${value}`);
  }
});

test("realistic values are accepted", () => {
  for (const value of ["0", "1", "125000", " 2500 "]) {
    const errors = validateLeadForm(withField({ value }));
    assert.equal(errors.value, undefined, `value: ${JSON.stringify(value)}`);
  }
});

// --- Scores -------------------------------------------------------------

test("scores outside 0-100 are rejected", () => {
  for (const field of ["score", "fitScore"] as const) {
    for (const value of ["-1", "101", "abc", "1e999"]) {
      const errors = validateLeadForm(withField({ [field]: value }));
      assert.equal(errors[field], "Use a score between 0 and 100.", `${field}: ${value}`);
    }
  }
});

test("cleared scores are rejected rather than silently becoming 0", () => {
  for (const field of ["score", "fitScore"] as const) {
    const errors = validateLeadForm(withField({ [field]: "" }));
    assert.equal(errors[field], "Use a score between 0 and 100.", `${field} was empty`);
  }
});

test("boundary scores are accepted", () => {
  for (const field of ["score", "fitScore"] as const) {
    for (const value of ["0", "100", " 50 "]) {
      const errors = validateLeadForm(withField({ [field]: value }));
      assert.equal(errors[field], undefined, `${field}: ${value}`);
    }
  }
});

// --- Follow-up date -----------------------------------------------------

test("a missing follow-up date is required", () => {
  const errors = validateLeadForm(withField({ nextFollowUp: "" }));
  assert.equal(errors.nextFollowUp, "Pick a follow-up date.");
});

test("an optional phone may be left blank", () => {
  assert.deepEqual(validateLeadForm(withField({ phone: "" })), {});
});
