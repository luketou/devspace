#!/usr/bin/env node
import { rmSync } from "node:fs";
import { initializeConfig, loadConfig } from "./config.js";
import { runDaemon } from "./daemon.js";
import { runDoctorChecks } from "./doctor.js";
import { formatCliError, runMcpServer } from "./mcp.js";
import { rpcCall } from "./rpc.js";
import {
  installService,
  serviceStatus,
  uninstallService,
} from "./service.js";
import type { BridgeStatus } from "./protocol.js";

process.umask(0o077);

type Command =
  | "init"
  | "doctor"
  | "daemon"
  | "login"
  | "logout"
  | "status"
  | "mcp"
  | "install-service"
  | "uninstall-service"
  | "help";

async function main(args: string[]): Promise<void> {
  const command = normalizeCommand(args[0]);

  if (command === "init") {
    const loaded = initializeConfig();
    console.log(`Config: ${loaded.paths.configFile}`);
    console.log(`Browser profile: ${loaded.paths.profileDir}`);
    console.log("Run: copilot-web-bridge doctor");
    return;
  }

  if (command === "help") {
    printHelp();
    return;
  }

  const loaded = loadConfig();
  switch (command) {
    case "doctor": {
      const checks = runDoctorChecks(loaded);
      for (const check of checks) {
        console.log(`${check.ok ? "OK" : "MISSING"}  ${check.name}: ${check.detail}`);
      }
      if (checks.some((check) => !check.ok)) process.exitCode = 1;
      return;
    }
    case "daemon":
      await runDaemon();
      return;
    case "mcp":
      await runMcpServer();
      return;
    case "status": {
      const status = await rpcCall<BridgeStatus>(loaded.paths.socketFile, {
        method: "status",
      });
      console.log(JSON.stringify(status, null, 2));
      return;
    }
    case "login": {
      const result = await rpcCall<{
        host: string;
        port: number;
        localUrl: string;
        localDesktop?: boolean;
      }>(loaded.paths.socketFile, { method: "login.start" });
      if (result.localDesktop) {
        console.log("A local browser window was opened for Microsoft sign-in.");
        console.log(`If needed, open: ${result.localUrl}`);
        console.log("Complete Microsoft sign-in and MFA, then run status.");
        return;
      }
      const server = args[1] ?? "<user@server>";
      console.log("Open an SSH tunnel from your local computer:");
      console.log(`ssh -L ${result.port}:127.0.0.1:${result.port} ${server}`);
      console.log(`Then open: ${result.localUrl}`);
      console.log("Complete Microsoft sign-in and MFA, then run status.");
      return;
    }
    case "logout":
      await rpcCall(loaded.paths.socketFile, { method: "logout" });
      console.log("Microsoft browser profile and conversation mappings were cleared.");
      return;
    case "install-service":
      console.log(`Installed: ${installService(loaded.paths)}`);
      console.log(serviceStatus());
      return;
    case "uninstall-service":
      console.log(`Removed: ${uninstallService()}`);
      return;
    default:
      return;
  }
}

function normalizeCommand(value: string | undefined): Command {
  if (!value || value === "help" || value === "--help" || value === "-h") {
    return "help";
  }
  const commands: Command[] = [
    "init",
    "doctor",
    "daemon",
    "login",
    "logout",
    "status",
    "mcp",
    "install-service",
    "uninstall-service",
    "help",
  ];
  if (commands.includes(value as Command)) return value as Command;
  throw new Error(`Unknown command: ${value}`);
}

function printHelp(): void {
  console.log(`copilot-web-bridge

Usage:
  copilot-web-bridge init
  copilot-web-bridge doctor
  copilot-web-bridge install-service
  copilot-web-bridge login [user@server]
  copilot-web-bridge status
  copilot-web-bridge logout
  copilot-web-bridge mcp
  copilot-web-bridge daemon
  copilot-web-bridge uninstall-service
`);
}

main(process.argv.slice(2)).catch((error) => {
  console.error(formatCliError(error));
  process.exitCode = 1;
});
