import assert from "node:assert/strict";
import test from "node:test";
import { BridgeError } from "./errors.js";
import { redactSensitiveContent } from "./redaction.js";

test("redacts common credentials while preserving ordinary context", () => {
  const result = redactSensitiveContent(
    [
      "Review this code.",
      "OPENAI_API_KEY=sk-abcdefghijklmnopqrstuvwxyz123456",
      "Authorization: Bearer eyJabcdefgh.ijklmnop.qrstuvwxyz",
    ].join("\n"),
    40000,
  );

  assert.doesNotMatch(result.text, /sk-abcdefghijklmnopqrstuvwxyz/);
  assert.match(result.text, /OPENAI_API_KEY=\[REDACTED:env-secret\]/);
  assert.match(result.text, /Authorization: \[REDACTED:authorization-header\]/);
  assert.ok(result.redactions.length >= 2);
});

test("blocks private key material", () => {
  assert.throws(
    () =>
      redactSensitiveContent(
        "-----BEGIN OPENSSH PRIVATE KEY-----\nsecret",
        40000,
      ),
    (error: unknown) =>
      error instanceof BridgeError &&
      error.code === "sensitive_content_blocked",
  );
});

test("enforces prompt length", () => {
  assert.throws(
    () => redactSensitiveContent("x".repeat(101), 100),
    (error: unknown) =>
      error instanceof BridgeError && error.code === "prompt_too_large",
  );
});
