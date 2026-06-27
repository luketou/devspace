import assert from "node:assert/strict";
import { mkdtempSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { defaultConfig, initializeConfig, loadConfig } from "./config.js";

test("runs the browser headlessly by default", () => {
  assert.equal(defaultConfig().headless, true);
});

test("prefers Think Deeper by default", () => {
  assert.equal(defaultConfig().preferredMode, "think_deeper");
});

test("supports a portable preferred-mode environment override", () => {
  const root = mkdtempSync(join(tmpdir(), "copilot-web-bridge-mode-"));
  const env = {
    HOME: root,
    COPILOT_WEB_BRIDGE_CONFIG_DIR: join(root, "config"),
    COPILOT_WEB_BRIDGE_DATA_DIR: join(root, "data"),
    COPILOT_WEB_BRIDGE_STATE_DIR: join(root, "state"),
  };
  initializeConfig(env);

  const loaded = loadConfig({
    ...env,
    COPILOT_WEB_BRIDGE_PREFERRED_MODE: "auto",
  });

  assert.equal(loaded.config.preferredMode, "auto");
});

test("initializes private portable directories and supports environment overrides", () => {
  const root = mkdtempSync(join(tmpdir(), "copilot-web-bridge-config-"));
  const env = {
    HOME: root,
    COPILOT_WEB_BRIDGE_CONFIG_DIR: join(root, "config"),
    COPILOT_WEB_BRIDGE_DATA_DIR: join(root, "data"),
    COPILOT_WEB_BRIDGE_STATE_DIR: join(root, "state"),
  };
  const initialized = initializeConfig(env);

  assert.equal(statSync(initialized.paths.configFile).mode & 0o777, 0o600);
  assert.equal(statSync(initialized.paths.profileDir).mode & 0o777, 0o700);

  const loaded = loadConfig({
    ...env,
    COPILOT_WEB_BRIDGE_MAX_TABS: "5",
    COPILOT_WEB_BRIDGE_HEADLESS: "true",
    COPILOT_WEB_BRIDGE_BROWSER_ENGINE: "webkit",
    COPILOT_WEB_BRIDGE_RESPONSE_POLL_MS: "100",
    COPILOT_WEB_BRIDGE_LOGIN_CHECK_INTERVAL_MS: "3000",
  });
  assert.equal(loaded.config.maxTabs, 5);
  assert.equal(loaded.config.headless, true);
  assert.equal(loaded.config.browserEngine, "webkit");
  assert.equal(loaded.config.stableWindowMs, 800);
  assert.equal(loaded.config.responsePollMs, 100);
  assert.equal(loaded.config.loginCheckIntervalMs, 3000);
});
