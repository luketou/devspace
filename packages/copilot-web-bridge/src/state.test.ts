import assert from "node:assert/strict";
import { mkdtempSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { StateStore } from "./state.js";

test("persists only conversation metadata", () => {
  const root = mkdtempSync(join(tmpdir(), "copilot-web-bridge-state-"));
  const databaseFile = join(root, "state.sqlite");
  const store = new StateStore(databaseFile);
  const now = new Date().toISOString();
  store.upsert({
    id: "00000000-0000-4000-8000-000000000000",
    url: "https://m365.cloud.microsoft/chat/conversations/1",
    title: "Review",
    status: "open",
    createdAt: now,
    lastUsedAt: now,
  });

  assert.equal(statSync(databaseFile).mode & 0o777, 0o600);
  assert.equal(store.list().length, 1);
  assert.equal(store.get("00000000-0000-4000-8000-000000000000")?.title, "Review");

  store.closeConversation("00000000-0000-4000-8000-000000000000");
  assert.equal(
    store.get("00000000-0000-4000-8000-000000000000")?.status,
    "closed",
  );
  store.close();
});
