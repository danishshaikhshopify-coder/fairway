import assert from "node:assert/strict";
import test from "node:test";
import { generateKeyPairSync, createVerify } from "node:crypto";
import { buildServiceAccountJwt } from "../src/lib/integrations/sheets/google.ts";

function base64urlDecode(segment: string): Buffer {
  const padded = segment.replace(/-/g, "+").replace(/_/g, "/").padEnd(
    segment.length + ((4 - (segment.length % 4)) % 4),
    "=",
  );
  return Buffer.from(padded, "base64");
}

test("buildServiceAccountJwt produces a verifiable, well-formed RS256 JWT", () => {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });

  const now = 1_700_000_000;
  const jwt = buildServiceAccountJwt("svc@project.iam.gserviceaccount.com", privateKey, now);
  const [headerSeg, claimSeg, sigSeg] = jwt.split(".");
  assert.ok(headerSeg && claimSeg && sigSeg, "JWT has three segments");

  const header = JSON.parse(base64urlDecode(headerSeg).toString("utf8"));
  assert.deepEqual(header, { alg: "RS256", typ: "JWT" });

  const claim = JSON.parse(base64urlDecode(claimSeg).toString("utf8"));
  assert.equal(claim.iss, "svc@project.iam.gserviceaccount.com");
  assert.equal(claim.scope, "https://www.googleapis.com/auth/spreadsheets.readonly");
  assert.equal(claim.aud, "https://oauth2.googleapis.com/token");
  assert.equal(claim.iat, now);
  assert.equal(claim.exp, now + 3600);

  const verifier = createVerify("RSA-SHA256");
  verifier.update(`${headerSeg}.${claimSeg}`);
  const signatureValid = verifier.verify(publicKey, base64urlDecode(sigSeg));
  assert.ok(signatureValid, "signature verifies against the matching public key");
});

test("buildServiceAccountJwt fails verification against a different key", () => {
  const { privateKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });
  const { publicKey: otherPublicKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });

  const jwt = buildServiceAccountJwt("svc@project.iam.gserviceaccount.com", privateKey);
  const [headerSeg, claimSeg, sigSeg] = jwt.split(".");
  const verifier = createVerify("RSA-SHA256");
  verifier.update(`${headerSeg}.${claimSeg}`);
  assert.equal(verifier.verify(otherPublicKey, base64urlDecode(sigSeg)), false);
});
