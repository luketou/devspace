import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { initializeConfig } from "./config.js";
import { runDoctorChecks } from "./doctor.js";

test("doctor does not require headless Linux service dependencies on macOS", () => {
  const root = mkdtempSync(join(tmpdir(), "copilot-web-bridge-doctor-"));
  const loaded = initializeConfig({
    HOME: root,
    COPILOT_WEB_BRIDGE_CONFIG_DIR: join(root, "config"),
    COPILOT_WEB_BRIDGE_DATA_DIR: join(root, "data"),
    COPILOT_WEB_BRIDGE_STATE_DIR: join(root, "state"),
  });

  const checks = runDoctorChecks(loaded, "darwin");
  const names = checks.map((check) => check.name);

  assert.ok(names.includes("Local desktop"));
  assert.ok(!names.includes("Virtual display"));
  assert.ok(!names.includes("noVNC"));
  assert.ok(!names.includes("systemd user"));
});

test("doctor checks WebKit when that browser engine is configured", () => {
  const root = mkdtempSync(join(tmpdir(), "copilot-web-bridge-doctor-"));
  const loaded = initializeConfig({
    HOME: root,
    COPILOT_WEB_BRIDGE_CONFIG_DIR: join(root, "config"),
    COPILOT_WEB_BRIDGE_DATA_DIR: join(root, "data"),
    COPILOT_WEB_BRIDGE_STATE_DIR: join(root, "state"),
    COPILOT_WEB_BRIDGE_BROWSER_ENGINE: "webkit",
  });

  const checks = runDoctorChecks(loaded, "darwin");
  const names = checks.map((check) => check.name);

  assert.ok(names.includes("WebKit"));
  assert.ok(!names.includes("Chromium"));
});
