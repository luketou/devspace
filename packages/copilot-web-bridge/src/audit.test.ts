import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { AuditLog } from "./audit.js";

test("writes private metadata-only audit events", () => {
  const root = mkdtempSync(join(tmpdir(), "copilot-web-bridge-audit-"));
  const audit = new AuditLog(root);
  audit.write("rpc_completed", {
    method: "ask",
    conversationId: "conversation-id",
    promptChars: 42,
  });

  const filePath = join(root, "audit.jsonl");
  assert.equal(statSync(filePath).mode & 0o777, 0o600);
  const content = readFileSync(filePath, "utf8");
  assert.match(content, /"promptChars":42/);
  assert.doesNotMatch(content, /prompt content/);
});
