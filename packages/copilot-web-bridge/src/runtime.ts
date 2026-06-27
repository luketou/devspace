import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import type { BridgeConfig } from "./config.js";
import { BridgeError } from "./errors.js";

export class DisplayRuntime {
  private xvfb?: ChildProcess;
  private xvnc?: ChildProcess;
  private x11vnc?: ChildProcess;
  private noVnc?: ChildProcess;

  constructor(private readonly config: BridgeConfig) {}

  async ensureDisplay(): Promise<string> {
    if (process.env.DISPLAY) return process.env.DISPLAY;

    const displaySocket = `/tmp/.X11-unix/X${this.config.display.slice(1)}`;
    if (!existsSync(displaySocket)) {
      if (commandExists("x11vnc")) {
        this.xvfb = spawn(
          "Xvfb",
          [
            this.config.display,
            "-screen",
            "0",
            "1440x1000x24",
            "-nolisten",
            "tcp",
            "-noreset",
          ],
          { stdio: "ignore" },
        );
      } else if (commandExists("Xvnc")) {
        this.xvnc = spawn(
          "Xvnc",
          [
            this.config.display,
            "-geometry",
            "1440x1000",
            "-depth",
            "24",
            "-localhost",
            "-SecurityTypes",
            "None",
            "-rfbport",
            String(this.config.vncPort),
          ],
          { stdio: "ignore" },
        );
      } else {
        throw new BridgeError(
          "display_server_missing",
          "Install Xvfb with x11vnc, or install Xvnc.",
        );
      }
      await waitForFile(
        displaySocket,
        5000,
        "The virtual display server did not create its display socket.",
      );
    }

    return this.config.display;
  }

  async startLoginAccess(): Promise<{ host: string; port: number }> {
    const display = await this.ensureDisplay();
    this.stopLoginAccess();

    if (!this.xvnc) {
      this.x11vnc = spawn(
        "x11vnc",
        [
          "-display",
          display,
          "-localhost",
          "-forever",
          "-shared",
          "-nopw",
          "-rfbport",
          String(this.config.vncPort),
        ],
        { stdio: "ignore" },
      );
    }

    const noVncProxy = findNoVncProxy();
    this.noVnc = spawn(
      noVncProxy.command,
      [
        ...noVncProxy.prefixArgs,
        "--listen",
        `${this.config.noVncHost}:${this.config.noVncPort}`,
        "--vnc",
        `127.0.0.1:${this.config.vncPort}`,
      ],
      { stdio: "ignore" },
    );

    await delay(700);
    if (
      (this.x11vnc && this.x11vnc.exitCode !== null) ||
      this.noVnc.exitCode !== null
    ) {
      this.stopLoginAccess();
      throw new BridgeError(
        "novnc_start_failed",
        "Unable to start x11vnc/noVNC. Run copilot-web-bridge doctor.",
      );
    }

    return { host: this.config.noVncHost, port: this.config.noVncPort };
  }

  stopLoginAccess(): void {
    for (const child of [this.noVnc, this.x11vnc]) {
      if (child && child.exitCode === null) child.kill("SIGTERM");
    }
    this.noVnc = undefined;
    this.x11vnc = undefined;
  }

  close(): void {
    this.stopLoginAccess();
    if (this.xvfb && this.xvfb.exitCode === null) this.xvfb.kill("SIGTERM");
    if (this.xvnc && this.xvnc.exitCode === null) this.xvnc.kill("SIGTERM");
  }
}

async function waitForFile(
  path: string,
  timeoutMs: number,
  message: string,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (existsSync(path)) return;
    await delay(100);
  }
  throw new BridgeError("display_start_failed", message);
}

function findNoVncProxy(): { command: string; prefixArgs: string[] } {
  const home = homedir();
  const candidates = [
    "/usr/share/novnc/utils/novnc_proxy",
    "/usr/share/novnc/utils/launch.sh",
    "/usr/bin/novnc_proxy",
    join(home, ".local", "share", "novnc", "utils", "novnc_proxy"),
  ];
  const path = candidates.find(existsSync);
  if (path) return { command: path, prefixArgs: [] };

  const webRootCandidates = [
    "/usr/share/novnc",
    "/usr/share/noVNC",
    join(home, ".local", "share", "novnc"),
  ];
  const webRoot = webRootCandidates.find((candidate) =>
    existsSync(join(candidate, "vnc.html")),
  );
  if (webRoot) {
    const userWebsockify = join(home, ".local", "bin", "websockify");
    return {
      command: existsSync(userWebsockify) ? userWebsockify : "websockify",
      prefixArgs: ["--web", webRoot],
    };
  }

  throw new BridgeError(
    "novnc_not_found",
    "noVNC is not installed or its web root could not be found.",
  );
}

function commandExists(command: string): boolean {
  const path = process.env.PATH ?? "";
  return path
    .split(":")
    .filter(Boolean)
    .some((directory) => existsSync(join(directory, command)));
}
