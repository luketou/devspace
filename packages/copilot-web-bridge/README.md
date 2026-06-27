# Copilot Web Bridge

`copilot-web-bridge` exposes a user-authenticated Microsoft 365 Copilot Chat
browser session as a small stdio MCP server. It is designed for a Linux server
that keeps Chromium running and for MCP clients that connect through SSH.

This is browser automation, not an official Microsoft MCP integration. The
Copilot website can change without notice. Use it only where browser automation
is permitted by your Microsoft agreement and organization policy.

## Choose a deployment

| Deployment | Browser daemon | MCP client | Connection |
| --- | --- | --- | --- |
| Local | Your workstation | The same workstation | Local stdio |
| Remote | A Linux server | Your workstation | SSH stdio |

Use the local setup when the MCP client and Microsoft browser session can run
on the same computer. Use the remote setup when Copilot should remain signed in
and available on an always-on Linux server.

In both deployments, the MCP process is a small stdio adapter. It connects to a
long-running browser daemon through a private Unix socket:

```text
MCP client -> copilot-web-bridge mcp -> private Unix socket
           -> browser daemon -> persistent browser profile
           -> Microsoft 365 Copilot Chat
```

Microsoft credentials, cookies, and MFA remain in the browser profile on the
machine running the daemon. They are never returned through MCP.

## Install the package

From npm after publication:

```bash
npm install --global copilot-web-bridge
```

From this checkout:

```bash
cd devspace/packages/copilot-web-bridge
npm install
npm run build
npm pack
npm install --global ./copilot-web-bridge-0.1.0.tgz
```

From the DevSpace repository root, development checks can also be run with:

```bash
cd devspace
npm run copilot-web:typecheck
npm run copilot-web:test
npm run copilot-web:build
```

The remaining steps depend on whether the bridge runs locally or remotely.

## Local setup

This setup runs the browser daemon and MCP client on the same macOS, Windows,
or desktop Linux computer.

### 1. Initialize and check the local runtime

```bash
copilot-web-bridge init
copilot-web-bridge doctor
```

If `doctor` reports a missing browser, install a Chromium-compatible browser or
set `browserEngine`/`chromiumExecutable` in:

```text
~/.config/copilot-web-bridge/config.json
```

### 2. Complete Microsoft sign-in

For the initial sign-in, set `"headless": false` in the config file and start
the daemon in one terminal:

```bash
copilot-web-bridge daemon
```

In another terminal, open the login page:

```bash
copilot-web-bridge login
```

Complete Microsoft sign-in, consent, CAPTCHA, and MFA yourself in the browser,
then verify:

```bash
copilot-web-bridge status
```

The expected status contains `"loggedIn": true`. You may then stop the daemon,
restore `"headless": true`, and start it again for normal use without a visible
browser window. Keep the daemon running while using the MCP server.

### 3. Add the local MCP server

For Codex CLI:

```bash
codex mcp add copilot-web -- copilot-web-bridge mcp
```

For an MCP client that accepts JSON configuration:

```json
{
  "mcpServers": {
    "copilot-web": {
      "command": "copilot-web-bridge",
      "args": ["mcp"]
    }
  }
}
```

Restart the MCP client after changing its configuration. If the globally
installed executable is not on the client's `PATH`, replace
`copilot-web-bridge` with its absolute path.

### 4. Verify local MCP use

Ask the MCP client to call `copilot_status`, then call `copilot_chat` with a
small test prompt. A ready installation reports `loggedIn: true` and returns a
Copilot response with mode metadata.

## Remote setup

This setup runs the browser daemon on a Linux server. The local MCP client uses
SSH to start the remote stdio adapter; no public MCP or browser-debugging port
is required.

### 1. Prepare the Linux server

Node.js 22–26 and a Chromium-compatible browser are required. On Ubuntu or
Debian:

```bash
sudo apt-get update
sudo apt-get install -y chromium xvfb x11vnc novnc websockify
```

Package names vary by distribution. On a rootless headless server, the bridge
can use `Xvnc` instead of the `Xvfb` plus `x11vnc` pair. A user-local noVNC
checkout at `~/.local/share/novnc` and `~/.local/bin/websockify` is detected
automatically.

Install the package on the server, then run:

```bash
copilot-web-bridge init
copilot-web-bridge doctor
loginctl enable-linger "$USER"
copilot-web-bridge install-service
```

`loginctl enable-linger` might require an administrator. It allows the systemd
user service to continue running after the SSH session ends. If Chromium is in
a nonstandard location, set `chromiumExecutable` in the bridge config.

### 2. Complete Microsoft sign-in through an SSH tunnel

For the initial login, set `"headless": false` in
`~/.config/copilot-web-bridge/config.json`, then restart the user service:

```bash
systemctl --user restart copilot-web-bridge.service
```

On the server, start login access:

```bash
copilot-web-bridge login user@server
```

The command prints the exact tunnel command and noVNC URL. On your local
computer, keep the printed tunnel open; it normally resembles:

```bash
ssh -L 6080:127.0.0.1:6080 user@server
```

Open the printed URL locally, normally:

```text
http://127.0.0.1:6080/vnc.html?autoconnect=1&resize=scale
```

Complete Microsoft sign-in, consent, CAPTCHA, and MFA yourself. Then check on
the server:

```bash
copilot-web-bridge status
```

The expected status contains `"loggedIn": true`. The noVNC endpoint binds only
to server loopback and stops automatically after the daemon observes a usable
Copilot prompt. After sign-in succeeds, restore `"headless": true` and restart
the service for normal operation without a visible browser session.

### 3. Confirm noninteractive SSH execution

From the local computer, this command must work without a password prompt:

```bash
ssh -o BatchMode=yes user@server copilot-web-bridge status
```

The remote account needs `copilot-web-bridge` on its noninteractive `PATH`. If
it is missing, use the executable's absolute path in this command and in the MCP
configuration.

### 4. Add the remote MCP server

For Codex CLI:

```bash
codex mcp add copilot-web -- ssh -o BatchMode=yes user@server copilot-web-bridge mcp
```

For an MCP client that accepts JSON configuration:

```json
{
  "mcpServers": {
    "copilot-web": {
      "command": "ssh",
      "args": [
        "-o",
        "BatchMode=yes",
        "user@server",
        "copilot-web-bridge",
        "mcp"
      ]
    }
  }
}
```

Restart the MCP client after changing its configuration, then call
`copilot_status` and `copilot_chat` to verify the complete path.

For tighter SSH access, use a dedicated Linux account and a key restricted in
`~/.ssh/authorized_keys`:

```text
restrict,command="/absolute/path/to/copilot-web-bridge mcp" ssh-ed25519 AAAA...
```

Use a separate key for login and service administration because a forced MCP
key cannot create the noVNC tunnel.

## Preferred reasoning mode

The bridge attempts `Think Deeper` before every `copilot_chat` and
`copilot_ask` request. This is a source-level policy, so it works consistently
after installing the bridge on another computer; browser profile preferences do
not need to be copied.

Each computer still requires its own Microsoft sign-in. If `Think Deeper` is
not available for an account or Microsoft changes the selector, the request
continues in `Auto` when possible and reports fallback metadata.

To prefer `Auto` explicitly, set either the config field:

```json
{
  "preferredMode": "auto"
}
```

or the service environment variable:

```text
COPILOT_WEB_BRIDGE_PREFERRED_MODE=auto
```

## MCP tools

- `copilot_status`
- `copilot_chat` (recommended fast path; automatically reuses or creates a conversation)
- `copilot_conversation_create`
- `copilot_conversation_list`
- `copilot_ask`
- `copilot_cancel`
- `copilot_conversation_close`

`copilot_ask` accepts an optional caller-generated `request_id`. Supply one if
you need to call `copilot_cancel` while the request is active.

Use `copilot_chat` for normal requests. It removes the separate
`copilot_conversation_create` round trip and keeps the most recently used
conversation warm. Use the lower-level conversation tools only when you need
multiple isolated threads.

Both request tools report the requested and verified effective mode. A fallback
response includes metadata such as:

```json
{
  "requestedMode": "think_deeper",
  "effectiveMode": "auto",
  "fallbackUsed": true,
  "modeWarning": "Unable to select Think Deeper; continuing with Auto when available."
}
```

## Triggering From Codex

After adding the MCP server to Codex, use an explicit phrase such as:

```text
Use Copilot Web to review this implementation.
用 Copilot Web 問：這段程式有什麼風險？
請讓 Copilot Web 提供第二意見，只傳必要的程式碼片段。
```

The project skill at
`.agents/skills/use-copilot-web/SKILL.md` maps these requests to
`copilot_chat`. Copilot output is untrusted advisory text; Codex should verify
it before changing code.

## Latency

For the lowest latency:

1. Keep the browser daemon running as a user service.
2. Keep the Microsoft session signed in.
3. Prefer `copilot_chat` so an existing conversation tab is reused.
4. Send only the relevant code or error excerpt.
5. Keep `maxTabs` small unless parallel Copilot conversations are required.

Response polling reads only the newest Copilot message, so long reused
conversations do not get progressively slower. The defaults favor faster
completion detection:

```json
{
  "responsePollMs": 150,
  "loginCheckIntervalMs": 2000,
  "stableWindowMs": 800
}
```

For a lower-latency local setup, `responsePollMs` can be reduced through
`COPILOT_WEB_BRIDGE_RESPONSE_POLL_MS`. If responses are occasionally truncated,
increase `stableWindowMs`.

The bridge defaults to three concurrent conversation tabs. Requests within the
same conversation are serialized. Conversation metadata and URLs survive daemon
restarts, but full prompts and responses are not copied into the local SQLite
database.

## Security behavior

- Common tokens, authorization headers, JWTs, and `.env` secrets are redacted.
- Private keys, cloud credential files, and service-account credentials are
  rejected.
- Prompt plus context is limited to 40,000 characters by default.
- Browser profile, configuration, database, runtime socket, and logs use
  user-private permissions.
- The audit log records method names, IDs, sizes, and outcomes, never complete
  prompts or responses.
- Chromium debugging and MCP HTTP ports are not exposed.
- Copilot output is returned as untrusted text and is never executed.

This protects against common accidental disclosures, not every possible secret.
Send only the minimum code and error context needed for the question.

## Operations

```bash
copilot-web-bridge status
copilot-web-bridge logout
copilot-web-bridge uninstall-service
```

`logout` deletes the persistent browser profile and conversation mappings.

When Microsoft changes the Copilot page and prompts stop working, update the
central selector lists in `src/browser.ts` and run the test suite before
redeploying.
