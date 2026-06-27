import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { BridgeError } from "./errors.js";
import { rpcCall, RpcSocketServer } from "./rpc.js";

test("round trips JSON RPC over a private Unix socket", async () => {
  const root = mkdtempSync(join(tmpdir(), "copilot-web-bridge-rpc-"));
  const socketFile = join(root, "bridge.sock");
  const server = new RpcSocketServer(socketFile, async (request) => {
    if (request.method === "status") return { daemon: "ready" };
    throw new BridgeError("unsupported", "unsupported");
  });
  await server.listen();
  try {
    assert.deepEqual(
      await rpcCall(socketFile, { method: "status" }),
      { daemon: "ready" },
    );
    await assert.rejects(
      rpcCall(socketFile, { method: "conversation.list" }),
      (error: unknown) =>
        error instanceof BridgeError && error.code === "unsupported",
    );
  } finally {
    await server.close();
  }
});
