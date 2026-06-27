import { homedir } from "node:os";
import { join, resolve } from "node:path";

export interface BridgePaths {
  configDir: string;
  configFile: string;
  dataDir: string;
  profileDir: string;
  databaseFile: string;
  stateDir: string;
  logDir: string;
  socketFile: string;
  serviceFile: string;
}

export function bridgePaths(env: NodeJS.ProcessEnv = process.env): BridgePaths {
  const home = env.HOME ?? homedir();
  const configDir = resolve(
    env.COPILOT_WEB_BRIDGE_CONFIG_DIR ??
      join(env.XDG_CONFIG_HOME ?? join(home, ".config"), "copilot-web-bridge"),
  );
  const dataDir = resolve(
    env.COPILOT_WEB_BRIDGE_DATA_DIR ??
      join(env.XDG_DATA_HOME ?? join(home, ".local", "share"), "copilot-web-bridge"),
  );
  const stateDir = resolve(
    env.COPILOT_WEB_BRIDGE_STATE_DIR ??
      join(env.XDG_STATE_HOME ?? join(home, ".local", "state"), "copilot-web-bridge"),
  );
  const runtimeDir = resolve(
    env.COPILOT_WEB_BRIDGE_RUNTIME_DIR ??
      env.XDG_RUNTIME_DIR ??
      join(stateDir, "run"),
  );

  return {
    configDir,
    configFile: join(configDir, "config.json"),
    dataDir,
    profileDir: join(dataDir, "browser-profile"),
    databaseFile: join(dataDir, "state.sqlite"),
    stateDir,
    logDir: join(stateDir, "logs"),
    socketFile: join(runtimeDir, "bridge.sock"),
    serviceFile: join(configDir, "copilot-web-bridge.service"),
  };
}
