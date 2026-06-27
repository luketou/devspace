# Copilot Web Bridge

`copilot-web-bridge` exposes a user-authenticated Microsoft 365 Copilot Chat
browser session as a small stdio MCP server. It is designed for a Linux server
that keeps Chromium running and for MCP clients that connect through SSH.

This is browser automation, not an official Microsoft MCP integration. The
Copilot website can change without notice. Use it only where browser automation
is permitted by your Microsoft agreement and organization policy.

## Architecture

```text
Codex or another MCP client
  -> ssh user@server copilot-web-bridge mcp
  -> private Unix socket
  -> systemd user daemon
  -> persistent Chromium profile
  -> Microsoft 365 Copilot Chat
```

Microsoft credentials, cookies, and MFA stay in the Chromium profile on the
server. They are never returned through MCP.

## Linux requirements

Node.js 22–26 and a Chromium-compatible browser are required. On Ubuntu or
Debian, install the runtime dependencies:

```bash
sudo apt-get update
sudo apt-get install -y chromium xvfb x11vnc novnc websockify
```

Package names vary by distribution. `copilot-web-bridge doctor` reports missing
commands. If Chromium is installed elsewhere, set `chromiumExecutable` in:

```text
~/.config/copilot-web-bridge/config.json
```

On a rootless headless server, the bridge can use `Xvnc` directly instead of
the `Xvfb` plus `x11vnc` pair. A user-local noVNC checkout at
`~/.local/share/novnc` and `~/.local/bin/websockify` are detected
automatically.

## Install

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

Initialize and install the user service:

```bash
copilot-web-bridge init
copilot-web-bridge doctor
loginctl enable-linger "$USER"
copilot-web-bridge install-service
```

`loginctl enable-linger` might require an administrator. It lets the user
service continue running after the SSH session ends.

## Microsoft login

Run this on the server:

```bash
copilot-web-bridge login user@server
```

The command prints an SSH tunnel command similar to:

```bash
ssh -L 6080:127.0.0.1:6080 user@server
```

Keep the tunnel open and browse locally to:

```text
http://127.0.0.1:6080/vnc.html?autoconnect=1&resize=scale
```

Complete Microsoft sign-in, consent, CAPTCHA, and MFA yourself. Then verify:

```bash
copilot-web-bridge status
```

The browser runs headlessly by default. For the initial interactive sign-in,
temporarily set `"headless": false` in
`~/.config/copilot-web-bridge/config.json`, restart the daemon, and run
`copilot-web-bridge login`. After sign-in succeeds, restore `"headless": true`
and restart the daemon for normal MCP use without a visible browser window.

The noVNC endpoint binds only to server loopback and is stopped automatically
after the daemon observes a usable Copilot prompt.

## Connect from another computer

Configure the MCP client to start the remote stdio command over SSH:

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

The remote account needs the package on its noninteractive `PATH`. If npm's
global bin directory is not loaded by SSH, use the full executable path.

For tighter SSH access, use a dedicated Linux account and a key restricted in
`~/.ssh/authorized_keys`:

```text
restrict,command="/absolute/path/to/copilot-web-bridge mcp" ssh-ed25519 AAAA...
```

Use a separate key for login and service administration because a forced MCP
key cannot create the noVNC tunnel.

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
