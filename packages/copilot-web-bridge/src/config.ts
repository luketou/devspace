import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { dirname } from "node:path";
import { z } from "zod";
import { bridgePaths, type BridgePaths } from "./paths.js";
import type { PreferredMode } from "./protocol.js";

const PreferredModeSchema = z.enum(["think_deeper", "auto"]);

const ConfigSchema = z.object({
  copilotUrl: z.string().url().default("https://m365.cloud.microsoft/chat"),
  browserEngine: z.enum(["chromium", "webkit"]).default("chromium"),
  chromiumExecutable: z.string().min(1).optional(),
  display: z.string().regex(/^:\d+$/).default(":99"),
  noVncHost: z.literal("127.0.0.1").default("127.0.0.1"),
  noVncPort: z.number().int().min(1024).max(65535).default(6080),
  vncPort: z.number().int().min(1024).max(65535).default(5900),
  maxTabs: z.number().int().min(1).max(10).default(3),
  maxPromptChars: z.number().int().min(1000).max(200000).default(40000),
  defaultTimeoutSeconds: z.number().int().min(15).max(600).default(120),
  stableWindowMs: z.number().int().min(500).max(10000).default(800),
  responsePollMs: z.number().int().min(50).max(2000).default(150),
  loginCheckIntervalMs: z.number().int().min(500).max(10000).default(2000),
  headless: z.boolean().default(true),
  preferredMode: PreferredModeSchema.default("think_deeper"),
});

export type BridgeConfig = z.infer<typeof ConfigSchema> & {
  preferredMode: PreferredMode;
};

export interface LoadedConfig {
  config: BridgeConfig;
  paths: BridgePaths;
}

export function defaultConfig(): BridgeConfig {
  return ConfigSchema.parse({});
}

export function initializeConfig(
  env: NodeJS.ProcessEnv = process.env,
): LoadedConfig {
  const paths = bridgePaths(env);
  for (const directory of [
    paths.configDir,
    paths.dataDir,
    paths.profileDir,
    paths.stateDir,
    paths.logDir,
    dirname(paths.socketFile),
  ]) {
    mkdirSync(directory, { recursive: true, mode: 0o700 });
  }

  if (!existsSync(paths.configFile)) {
    writeFileSync(
      paths.configFile,
      `${JSON.stringify(defaultConfig(), null, 2)}\n`,
      { mode: 0o600 },
    );
  }
  chmodSync(paths.configFile, 0o600);
  for (const directory of [
    paths.configDir,
    paths.dataDir,
    paths.profileDir,
    paths.stateDir,
    paths.logDir,
    dirname(paths.socketFile),
  ]) {
    chmodSync(directory, 0o700);
  }

  return loadConfig(env);
}

export function loadConfig(
  env: NodeJS.ProcessEnv = process.env,
): LoadedConfig {
  const paths = bridgePaths(env);
  const persisted = existsSync(paths.configFile)
    ? JSON.parse(readFileSync(paths.configFile, "utf8")) as unknown
    : {};

  const overrides: Record<string, unknown> = {};
  if (env.COPILOT_WEB_BRIDGE_CHROMIUM) {
    overrides.chromiumExecutable = env.COPILOT_WEB_BRIDGE_CHROMIUM;
  }
  if (env.COPILOT_WEB_BRIDGE_BROWSER_ENGINE) {
    overrides.browserEngine = env.COPILOT_WEB_BRIDGE_BROWSER_ENGINE;
  }
  if (env.COPILOT_WEB_BRIDGE_HEADLESS !== undefined) {
    overrides.headless = parseBoolean(env.COPILOT_WEB_BRIDGE_HEADLESS);
  }
  if (env.COPILOT_WEB_BRIDGE_MAX_TABS) {
    overrides.maxTabs = Number(env.COPILOT_WEB_BRIDGE_MAX_TABS);
  }
  if (env.COPILOT_WEB_BRIDGE_RESPONSE_POLL_MS) {
    overrides.responsePollMs = Number(env.COPILOT_WEB_BRIDGE_RESPONSE_POLL_MS);
  }
  if (env.COPILOT_WEB_BRIDGE_LOGIN_CHECK_INTERVAL_MS) {
    overrides.loginCheckIntervalMs = Number(
      env.COPILOT_WEB_BRIDGE_LOGIN_CHECK_INTERVAL_MS,
    );
  }
  if (env.COPILOT_WEB_BRIDGE_PREFERRED_MODE) {
    overrides.preferredMode = env.COPILOT_WEB_BRIDGE_PREFERRED_MODE;
  }

  return {
    config: ConfigSchema.parse({ ...(persisted as object), ...overrides }),
    paths,
  };
}

function parseBoolean(value: string): boolean {
  return ["1", "true", "yes", "on"].includes(value.toLowerCase());
}
