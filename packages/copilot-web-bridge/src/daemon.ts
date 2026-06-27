import { mkdirSync, rmSync } from "node:fs";
import { dirname } from "node:path";
import { loadConfig } from "./config.js";
import { CopilotBrowser } from "./browser.js";
import { DisplayRuntime } from "./runtime.js";
import { RpcSocketServer } from "./rpc.js";
import type { RpcRequest } from "./protocol.js";
import { StateStore } from "./state.js";
import { BridgeError } from "./errors.js";
import { AuditLog } from "./audit.js";

export async function runDaemon(): Promise<void> {
  const { config, paths } = loadConfig();
  mkdirSync(dirname(paths.socketFile), { recursive: true, mode: 0o700 });
  mkdirSync(paths.profileDir, { recursive: true, mode: 0o700 });

  const store = new StateStore(paths.databaseFile);
  const audit = new AuditLog(paths.logDir);
  const runtime = new DisplayRuntime(config);
  const display = await resolveBrowserDisplay(config, runtime);
  const browser = new CopilotBrowser(
    config,
    paths.profileDir,
    store,
    display,
  );
  await browser.start();

  let server: RpcSocketServer;
  const dispatch = async (request: RpcRequest): Promise<unknown> => {
    switch (request.method) {
      case "status": {
        const status = await browser.status();
        if (status.loggedIn) runtime.stopLoginAccess();
        return status;
      }
      case "conversation.create":
        return browser.createConversation(request.params?.title);
      case "conversation.list":
        return browser.listConversations();
      case "conversation.close":
        await browser.closeConversation(request.params.conversationId);
        return { closed: true };
      case "chat":
        return browser.chat(request.params);
      case "ask":
        return browser.ask(request.params);
      case "cancel":
        return { cancelled: await browser.cancel(request.params.requestId) };
      case "login.start": {
        await browser.openLoginPage();
        if (!display) {
          return {
            host: "127.0.0.1",
            port: 0,
            localUrl: config.copilotUrl,
            localDesktop: true,
          };
        }
        const access = await runtime.startLoginAccess();
        return {
          ...access,
          localUrl: `http://${access.host}:${access.port}/vnc.html?autoconnect=1&resize=scale`,
        };
      }
      case "logout":
        await browser.close();
        runtime.stopLoginAccess();
        store.deleteAll();
        rmSync(paths.profileDir, { recursive: true, force: true });
        mkdirSync(paths.profileDir, { recursive: true, mode: 0o700 });
        await browser.start();
        return { loggedOut: true };
      case "shutdown":
        queueMicrotask(() => void shutdown());
        return { shuttingDown: true };
      default:
        throw new BridgeError(
          "unknown_method",
          `Unsupported daemon method: ${(request as RpcRequest).method}`,
        );
    }
  };
  server = new RpcSocketServer(paths.socketFile, async (request) => {
    const fields = auditFields(request);
    audit.write("rpc_started", fields);
    try {
      const result = await dispatch(request);
      audit.write("rpc_completed", fields);
      return result;
    } catch (error) {
      audit.write("rpc_failed", {
        ...fields,
        errorCode: error instanceof BridgeError ? error.code : "internal_error",
      });
      throw error;
    }
  });
  await server.listen();
  audit.write("daemon_started", {
    socketFile: paths.socketFile,
    maxTabs: config.maxTabs,
  });
  process.stderr.write(
    `copilot-web-bridge daemon ready on ${paths.socketFile}\n`,
  );

  let shuttingDown = false;
  async function shutdown(): Promise<void> {
    if (shuttingDown) return;
    shuttingDown = true;
    await server.close();
    await browser.close();
    runtime.close();
    store.close();
    audit.write("daemon_stopped");
  }

  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.once(signal, () => {
      void shutdown().finally(() => process.exit(0));
    });
  }
}

export async function resolveBrowserDisplay(
  config: { headless: boolean; display: string },
  runtime: Pick<DisplayRuntime, "ensureDisplay">,
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): Promise<string | undefined> {
  if (config.headless) return env.DISPLAY;
  if (env.DISPLAY) return env.DISPLAY;
  if (platform === "darwin" || platform === "win32") return undefined;
  return runtime.ensureDisplay();
}

function auditFields(
  request: RpcRequest,
): Record<string, string | number | boolean | undefined> {
  switch (request.method) {
    case "ask":
      return {
        method: request.method,
        conversationId: request.params.conversationId,
        requestId: request.params.requestId,
        promptChars: request.params.prompt.length,
        contextChars: request.params.context?.length ?? 0,
      };
    case "conversation.close":
      return {
        method: request.method,
        conversationId: request.params.conversationId,
      };
    case "cancel":
      return { method: request.method, requestId: request.params.requestId };
    default:
      return { method: request.method };
  }
}
