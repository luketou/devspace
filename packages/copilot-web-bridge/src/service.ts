import {
  chmodSync,
  mkdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import type { BridgePaths } from "./paths.js";
import { BridgeError } from "./errors.js";

export function installService(paths: BridgePaths): string {
  const cliPath = fileURLToPath(new URL("./cli.js", import.meta.url));
  const unitPath = userUnitPath();
  mkdirSync(dirname(unitPath), { recursive: true, mode: 0o700 });
  const unit = `[Unit]
Description=Copilot Web Bridge browser daemon
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
ExecStart=${systemdEscape(process.execPath)} ${systemdEscape(cliPath)} daemon
Restart=on-failure
RestartSec=3
Environment=COPILOT_WEB_BRIDGE_CONFIG_DIR=${systemdEscape(paths.configDir)}
Environment=COPILOT_WEB_BRIDGE_DATA_DIR=${systemdEscape(paths.dataDir)}
Environment=COPILOT_WEB_BRIDGE_STATE_DIR=${systemdEscape(paths.stateDir)}

[Install]
WantedBy=default.target
`;
  writeFileSync(unitPath, unit, { mode: 0o600 });
  chmodSync(unitPath, 0o600);
  runSystemctl(["daemon-reload"]);
  runSystemctl(["enable", "--now", "copilot-web-bridge.service"]);
  return unitPath;
}

export function uninstallService(): string {
  const unitPath = userUnitPath();
  runSystemctl(["disable", "--now", "copilot-web-bridge.service"], true);
  try {
    unlinkSync(unitPath);
  } catch {
    // Already removed.
  }
  runSystemctl(["daemon-reload"]);
  return unitPath;
}

export function serviceStatus(): string {
  const result = spawnSync(
    "systemctl",
    ["--user", "status", "copilot-web-bridge.service", "--no-pager"],
    { encoding: "utf8" },
  );
  return `${result.stdout}${result.stderr}`.trim();
}

function userUnitPath(): string {
  const home = process.env.HOME;
  if (!home) throw new BridgeError("home_missing", "HOME is not set.");
  return `${home}/.config/systemd/user/copilot-web-bridge.service`;
}

function runSystemctl(args: string[], allowFailure = false): void {
  const result = spawnSync("systemctl", ["--user", ...args], {
    encoding: "utf8",
  });
  if (!allowFailure && result.status !== 0) {
    throw new BridgeError(
      "systemd_error",
      (result.stderr || result.stdout || "systemctl failed").trim(),
    );
  }
}

function systemdEscape(value: string): string {
  if (/^[A-Za-z0-9_./:@+-]+$/.test(value)) return value;
  return `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
}
