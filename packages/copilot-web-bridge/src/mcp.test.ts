import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { initializeConfig } from "./config.js";
import { RpcSocketServer } from "./rpc.js";

test("exposes status and conversation tools through stdio MCP", async () => {
  const root = mkdtempSync(join(tmpdir(), "copilot-web-bridge-mcp-"));
  const env = {
    ...process.env,
    HOME: root,
    COPILOT_WEB_BRIDGE_CONFIG_DIR: join(root, "config"),
    COPILOT_WEB_BRIDGE_DATA_DIR: join(root, "data"),
    COPILOT_WEB_BRIDGE_STATE_DIR: join(root, "state"),
    COPILOT_WEB_BRIDGE_RUNTIME_DIR: join(root, "run"),
  };
  mkdirSync(env.COPILOT_WEB_BRIDGE_RUNTIME_DIR, {
    recursive: true,
    mode: 0o700,
  });
  const loaded = initializeConfig(env);
  const rpc = new RpcSocketServer(loaded.paths.socketFile, async (request) => {
    if (request.method === "status") {
      return {
        daemon: "ready",
        loggedIn: true,
        interactiveLoginRequired: false,
        activeTabs: 0,
        maxTabs: 3,
        queuedRequests: 0,
        copilotUrl: "https://m365.cloud.microsoft/chat",
      };
    }
    if (request.method === "conversation.list") return [];
    if (request.method === "chat") {
      return {
        requestId: "00000000-0000-4000-8000-000000000001",
        conversationId: "00000000-0000-4000-8000-000000000002",
        conversationUrl: "https://m365.cloud.microsoft/chat/conversations/1",
        response: "COPILOT_WEB_OK",
        redactions: [],
      };
    }
    throw new Error(`unexpected ${request.method}`);
  });
  await rpc.listen();

  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ["--import", "tsx", "src/cli.ts", "mcp"],
    cwd: process.cwd(),
    env,
    stderr: "pipe",
  });
  const client = new Client({ name: "bridge-test", version: "1.0.0" });

  try {
    await client.connect(transport);
    const tools = await client.listTools();
    assert.ok(tools.tools.some((tool) => tool.name === "copilot_status"));
    assert.ok(tools.tools.some((tool) => tool.name === "copilot_chat"));
    assert.ok(tools.tools.some((tool) => tool.name === "copilot_ask"));

    const result = await client.callTool({ name: "copilot_status", arguments: {} });
    assert.equal(result.isError, undefined);
    const content = result.content as Array<{ type: string; text?: string }>;
    assert.match(content[0]?.text ?? "", /"loggedIn": true/);

    const chatResult = await client.callTool({
      name: "copilot_chat",
      arguments: { prompt: "Reply with exactly: COPILOT_WEB_OK" },
    });
    assert.equal(chatResult.isError, undefined);
    const chatContent = chatResult.content as Array<{
      type: string;
      text?: string;
    }>;
    assert.match(chatContent[0]?.text ?? "", /COPILOT_WEB_OK/);
  } finally {
    await client.close();
    await rpc.close();
  }
});
