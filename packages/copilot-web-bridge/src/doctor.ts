import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";
import { chromium, webkit } from "playwright-core";
import type { LoadedConfig } from "./config.js";

export interface DoctorCheck {
  name: string;
  ok: boolean;
  detail: string;
}

export function runDoctorChecks(
  loaded: LoadedConfig,
  platform: NodeJS.Platform = process.platform,
): DoctorCheck[] {
  const browser = loaded.config.browserEngine === "webkit"
    ? {
        ok: existsSync(webkit.executablePath()),
        detail: webkit.executablePath(),
      }
    : loaded.config.chromiumExecutable
    ? {
        ok: existsSync(loaded.config.chromiumExecutable),
        detail: loaded.config.chromiumExecutable,
      }
    : findCommand([
        "google-chrome",
        "google-chrome-stable",
        "chromium",
        "chromium-browser",
      ], [
        chromium.executablePath(),
        "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
        "/Applications/Chromium.app/Contents/MacOS/Chromium",
        "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
        "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
      ]);

  const checks: DoctorCheck[] = [
    {
      name: "Node",
      ok: Number(process.versions.node.split(".")[0]) >= 22,
      detail: process.version,
    },
    {
      name: loaded.config.browserEngine === "webkit" ? "WebKit" : "Chromium",
      ...browser,
    },
    {
      name: "Config",
      ok: existsSync(loaded.paths.configFile),
      detail: loaded.paths.configFile,
    },
    {
      name: "Profile permissions",
      ok: existsSync(loaded.paths.profileDir),
      detail: loaded.paths.profileDir,
    },
  ];

  if (platform === "darwin" || platform === "win32") {
    checks.splice(2, 0, {
      name: "Local desktop",
      ok: true,
      detail: `${platform} browser window; virtual display not required`,
    });
    return checks;
  }

  checks.splice(
    2,
    0,
    { name: "Virtual display", ...findCommand(["Xvfb", "Xvnc"]) },
    {
      name: "VNC server",
      ...findCommand(["x11vnc", "Xvnc"]),
    },
    {
      name: "noVNC",
      ...findCommand(["novnc_proxy", "websockify"], [
        "/usr/share/novnc/utils/novnc_proxy",
        "/usr/share/novnc/vnc.html",
        join(homedir(), ".local", "bin", "websockify"),
        join(homedir(), ".local", "share", "novnc", "vnc.html"),
      ]),
    },
    { name: "systemd user", ...checkSystemdUser() },
  );
  return checks;
}

function findCommand(
  names: string[],
  fallbackPaths: string[] = [],
): { ok: boolean; detail: string } {
  for (const name of names) {
    const result = spawnSync("sh", ["-lc", `command -v ${name}`], {
      encoding: "utf8",
    });
    if (result.status === 0) return { ok: true, detail: result.stdout.trim() };
  }
  const path = fallbackPaths.find(existsSync);
  return path
    ? { ok: true, detail: path }
    : { ok: false, detail: `missing (${names.join(" or ")})` };
}

function checkSystemdUser(): { ok: boolean; detail: string } {
  const result = spawnSync("systemctl", ["--user", "--version"], {
    encoding: "utf8",
  });
  return {
    ok: result.status === 0,
    detail: result.status === 0
      ? result.stdout.split("\n")[0]
      : (result.stderr || "systemctl --user unavailable").trim(),
  };
}
