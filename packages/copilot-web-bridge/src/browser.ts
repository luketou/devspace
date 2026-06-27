import { existsSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import {
  chromium,
  webkit,
  type BrowserContext,
  type BrowserType,
  type Locator,
  type Page,
} from "playwright-core";
import type { BridgeConfig } from "./config.js";
import { BridgeError } from "./errors.js";
import { ensurePreferredMode } from "./mode.js";
import type { AskResult, BridgeStatus, ConversationRecord } from "./protocol.js";
import { redactSensitiveContent } from "./redaction.js";
import { StateStore } from "./state.js";

const INPUT_SELECTORS = [
  'textarea[placeholder*="message" i]',
  'textarea[aria-label*="message" i]',
  '[contenteditable="true"][role="textbox"]',
  '[contenteditable="true"][data-lexical-editor="true"]',
];
const RESPONSE_SELECTORS = [
  '[data-testid="markdown-reply"]',
  '[data-testid="lastChatMessage"]',
  '[data-testid*="message"][data-testid*="assistant"]',
  '[data-testid*="response"]',
  '[data-content="ai-message"]',
  '[role="article"] .markdown',
  'main .markdown',
];
const STOP_SELECTORS = [
  'button[aria-label*="stop" i]',
  'button[title*="stop" i]',
  'button:has-text("Stop generating")',
  'button[aria-label*="停止"]',
  'button[title*="停止"]',
];
const SEND_SELECTORS = [
  'button[aria-label*="send" i]',
  'button[title*="send" i]',
  'button[data-testid*="send" i]',
  'button[aria-label*="submit" i]',
  'button[title*="submit" i]',
  'button[data-testid*="submit" i]',
  'button:has-text("Send")',
  'button:has-text("Submit")',
  'button[aria-label*="傳送"]',
  'button[title*="傳送"]',
  'button[aria-label*="发送"]',
  'button[title*="发送"]',
  'button[aria-label*="送出"]',
  'button[title*="送出"]',
  'button[aria-label*="提交"]',
  'button[title*="提交"]',
];

interface ActiveRequest {
  requestId: string;
  abortController: AbortController;
}

export class CopilotBrowser {
  private context?: BrowserContext;
  private readonly pages = new Map<string, Page>();
  private readonly activeRequests = new Map<string, ActiveRequest>();
  private readonly conversationLocks = new Set<string>();
  private waitingForSlot = 0;

  constructor(
    private readonly config: BridgeConfig,
    private readonly profileDir: string,
    private readonly store: StateStore,
    private readonly display?: string,
  ) {}

  async start(): Promise<void> {
    if (this.context) return;
    const browserType = browserTypeForEngine(this.config.browserEngine);
    const executablePath = executablePathForEngine(this.config);
    this.context = await browserType.launchPersistentContext(this.profileDir, {
      ...(executablePath ? { executablePath } : {}),
      headless: this.config.headless,
      viewport: { width: 1400, height: 920 },
      env: {
        ...process.env,
        ...(this.display ? { DISPLAY: this.display } : {}),
      },
      args: [
        "--disable-dev-shm-usage",
        "--disable-background-networking",
        "--disable-features=Translate",
        "--no-first-run",
        "--no-default-browser-check",
      ],
    });

    this.context.on("page", (page) => {
      page.on("close", () => {
        for (const [id, knownPage] of this.pages) {
          if (knownPage === page) this.pages.delete(id);
        }
      });
    });
  }

  async status(): Promise<BridgeStatus> {
    const page = await this.loginPage();
    const loggedIn = page ? await hasPromptInput(page) : false;
    return {
      daemon: "ready",
      loggedIn,
      interactiveLoginRequired: !loggedIn,
      activeTabs: this.pages.size,
      maxTabs: this.config.maxTabs,
      queuedRequests: this.waitingForSlot,
      copilotUrl: this.config.copilotUrl,
    };
  }

  async openLoginPage(): Promise<void> {
    const page = await this.loginPage(true);
    if (!page) {
      throw new BridgeError(
        "browser_page_unavailable",
        "Unable to create a browser page for Microsoft sign-in.",
      );
    }
    await page.goto(this.config.copilotUrl, { waitUntil: "domcontentloaded" });
    await page.bringToFront();
  }

  async createConversation(title?: string): Promise<ConversationRecord> {
    await this.waitForTabSlot();
    const id = randomUUID();
    const reusablePage = await this.untrackedPromptPage();
    const page = reusablePage ?? await this.requireContext().newPage();
    try {
      if (!reusablePage) {
        await page.goto(this.config.copilotUrl, {
          waitUntil: "domcontentloaded",
          timeout: 30000,
        });
      }
      if (!(await hasPromptInput(page))) {
        if (!reusablePage) await page.close();
        throw new BridgeError(
          "interactive_login_required",
          "Microsoft sign-in, MFA, consent, or CAPTCHA requires interactive login.",
        );
      }

      this.pages.set(id, page);
      const now = new Date().toISOString();
      const record: ConversationRecord = {
        id,
        url: page.url(),
        title,
        status: "open",
        createdAt: now,
        lastUsedAt: now,
      };
      this.store.upsert(record);
      return record;
    } catch (error) {
      if (!page.isClosed()) await page.close();
      throw error;
    }
  }

  listConversations(): ConversationRecord[] {
    return this.store.list();
  }

  async closeConversation(id: string): Promise<void> {
    const page = this.pages.get(id);
    if (page && !page.isClosed()) await page.close();
    this.pages.delete(id);
    this.store.closeConversation(id);
  }

  async ask(params: {
    conversationId: string;
    requestId?: string;
    prompt: string;
    context?: string;
    timeoutSeconds?: number;
  }): Promise<AskResult> {
    if (this.conversationLocks.has(params.conversationId)) {
      throw new BridgeError(
        "conversation_busy",
        "This conversation already has a request in progress.",
      );
    }

    const page = await this.pageForConversation(params.conversationId);
    const combined = params.context
      ? `${params.prompt}\n\n<context>\n${params.context}\n</context>`
      : params.prompt;
    const sanitized = redactSensitiveContent(
      combined,
      this.config.maxPromptChars,
    );
    const requestId = params.requestId ?? randomUUID();
    if (this.activeRequests.has(requestId)) {
      throw new BridgeError(
        "request_id_in_use",
        `Request ID ${requestId} is already in use.`,
      );
    }
    const abortController = new AbortController();
    this.activeRequests.set(requestId, { requestId, abortController });
    this.conversationLocks.add(params.conversationId);

    try {
      const timeoutMs =
        (params.timeoutSeconds ?? this.config.defaultTimeoutSeconds) * 1000;
      await promptInput(page);
      const modeSelection = await ensurePreferredMode(
        page,
        this.config.preferredMode,
      );
      const input = await promptInput(page);
      const before = await responseSnapshot(page);
      await fillPrompt(input, sanitized.text);
      await sendPrompt(page, input);

      const response = await waitForResponse({
        page,
        before,
        timeoutMs,
        stableWindowMs: this.config.stableWindowMs,
        responsePollMs: this.config.responsePollMs,
        loginCheckIntervalMs: this.config.loginCheckIntervalMs,
        signal: abortController.signal,
      });
      const now = new Date().toISOString();
      const existing = this.store.get(params.conversationId);
      this.store.upsert({
        id: params.conversationId,
        url: page.url(),
        title: existing?.title,
        status: "open",
        createdAt: existing?.createdAt ?? now,
        lastUsedAt: now,
      });

      return {
        requestId,
        conversationId: params.conversationId,
        conversationUrl: page.url(),
        response,
        redactions: sanitized.redactions,
        ...modeSelection,
      };
    } finally {
      this.activeRequests.delete(requestId);
      this.conversationLocks.delete(params.conversationId);
    }
  }

  async chat(params: {
    conversationId?: string;
    requestId?: string;
    title?: string;
    prompt: string;
    context?: string;
    timeoutSeconds?: number;
  }): Promise<AskResult> {
    const requested = params.conversationId
      ? this.store.get(params.conversationId)
      : undefined;
    const reusable =
      requested?.status === "open"
        ? requested
        : this.store.list().find((record) => record.status === "open");
    const conversation =
      reusable ?? await this.createConversation(params.title ?? "Copilot Web");

    try {
      return await this.ask({
        conversationId: conversation.id,
        requestId: params.requestId,
        prompt: params.prompt,
        context: params.context,
        timeoutSeconds: params.timeoutSeconds,
      });
    } catch (error) {
      if (
        params.conversationId ||
        !(error instanceof BridgeError) ||
        !["conversation_unavailable", "interactive_login_required"].includes(
          error.code,
        )
      ) {
        throw error;
      }

      this.store.closeConversation(conversation.id);
      const replacement = await this.createConversation(
        params.title ?? "Copilot Web",
      );
      return this.ask({
        conversationId: replacement.id,
        requestId: params.requestId,
        prompt: params.prompt,
        context: params.context,
        timeoutSeconds: params.timeoutSeconds,
      });
    }
  }

  async cancel(requestId: string): Promise<boolean> {
    const active = this.activeRequests.get(requestId);
    if (!active) return false;
    active.abortController.abort();
    for (const page of this.pages.values()) {
      const stop = await firstVisible(page, STOP_SELECTORS);
      if (stop) await stop.click().catch(() => undefined);
    }
    return true;
  }

  async logout(): Promise<void> {
    await this.close();
    this.store.deleteAll();
  }

  async close(): Promise<void> {
    for (const request of this.activeRequests.values()) {
      request.abortController.abort();
    }
    this.activeRequests.clear();
    this.pages.clear();
    if (this.context) await this.context.close();
    this.context = undefined;
  }

  private async pageForConversation(id: string): Promise<Page> {
    const existing = this.pages.get(id);
    if (existing && !existing.isClosed()) return existing;

    const record = this.store.get(id);
    if (!record || record.status !== "open") {
      throw new BridgeError(
        "conversation_unavailable",
        `Conversation ${id} is not available.`,
      );
    }

    await this.waitForTabSlot();
    const page = await this.requireContext().newPage();
    await page.goto(record.url, {
      waitUntil: "domcontentloaded",
      timeout: 30000,
    });
    if (!(await hasPromptInput(page))) {
      await page.close();
      throw new BridgeError(
        "interactive_login_required",
        "The browser session needs interactive Microsoft sign-in.",
      );
    }
    this.pages.set(id, page);
    return page;
  }

  private async loginPage(create = false): Promise<Page | undefined> {
    const context = this.requireContext();
    const pages = context.pages();
    const candidate =
      pages.find((page) => page.url().includes("m365.cloud.microsoft")) ??
      pages[0];
    if (candidate || !create) return candidate;
    return context.newPage();
  }

  private async untrackedPromptPage(): Promise<Page | undefined> {
    const tracked = new Set(this.pages.values());
    for (const page of this.requireContext().pages()) {
      if (
        !page.isClosed() &&
        !tracked.has(page) &&
        page.url().includes("m365.cloud.microsoft") &&
        await hasPromptInput(page)
      ) {
        return page;
      }
    }
    return undefined;
  }

  private async waitForTabSlot(): Promise<void> {
    if (this.pages.size < this.config.maxTabs) return;
    this.waitingForSlot += 1;
    try {
      const deadline = Date.now() + 30000;
      while (this.pages.size >= this.config.maxTabs && Date.now() < deadline) {
        await delay(200);
      }
      if (this.pages.size >= this.config.maxTabs) {
        throw new BridgeError(
          "tab_limit_reached",
          `All ${this.config.maxTabs} Copilot tabs are in use.`,
        );
      }
    } finally {
      this.waitingForSlot -= 1;
    }
  }

  private requireContext(): BrowserContext {
    if (!this.context) {
      throw new BridgeError("daemon_not_ready", "Browser context is not running.");
    }
    return this.context;
  }
}

async function hasPromptInput(page: Page): Promise<boolean> {
  return Boolean(await firstVisible(page, INPUT_SELECTORS));
}

async function promptInput(page: Page): Promise<Locator> {
  const input = await firstVisible(page, INPUT_SELECTORS);
  if (!input) {
    throw new BridgeError(
      "interactive_login_required",
      "Copilot prompt input is unavailable. Interactive login may be required.",
    );
  }
  return input;
}

async function fillPrompt(input: Locator, text: string): Promise<void> {
  const tagName = await input.evaluate((element) => element.tagName.toLowerCase());
  if (tagName === "textarea" || tagName === "input") {
    await input.fill(text);
  } else {
    await input.click();
    await input.press("ControlOrMeta+A");
    await input.fill(text);
  }
}

async function sendPrompt(page: Page, input: Locator): Promise<void> {
  const sendButton = await firstEnabledVisibleNear(page, input, SEND_SELECTORS, 5000);
  if (sendButton) {
    await sendButton.click();
    return;
  }

  await input.press("Enter");
  await delay(300);
  if (await firstVisible(page, STOP_SELECTORS)) return;

  await input.press("ControlOrMeta+Enter");
}

async function firstVisible(
  page: Page,
  selectors: string[],
): Promise<Locator | undefined> {
  for (const selector of selectors) {
    const locator = page.locator(selector);
    const count = await locator.count();
    for (let index = count - 1; index >= 0; index -= 1) {
      const candidate = locator.nth(index);
      if (await candidate.isVisible().catch(() => false)) return candidate;
    }
  }
  return undefined;
}

async function firstEnabledVisibleNear(
  page: Page,
  anchor: Locator,
  selectors: string[],
  timeoutMs = 0,
): Promise<Locator | undefined> {
  const deadline = Date.now() + timeoutMs;
  do {
    const anchorBox = await anchor.boundingBox().catch(() => null);
    for (const selector of selectors) {
      const locator = page.locator(selector);
      const count = await locator.count();
      for (let index = count - 1; index >= 0; index -= 1) {
        const candidate = locator.nth(index);
        if (!(await candidate.isVisible().catch(() => false))) continue;
        if (await candidate.isDisabled().catch(() => false)) continue;
        const ariaDisabled = await candidate
          .getAttribute("aria-disabled")
          .catch(() => null);
        if (ariaDisabled === "true") continue;
        if (anchorBox && !(await isNearPromptInput(candidate, anchorBox))) {
          continue;
        }
        return candidate;
      }
    }
    if (Date.now() < deadline) await delay(100);
  } while (Date.now() < deadline);
  return undefined;
}

async function isNearPromptInput(
  candidate: Locator,
  anchorBox: NonNullable<Awaited<ReturnType<Locator["boundingBox"]>>>,
): Promise<boolean> {
  const box = await candidate.boundingBox().catch(() => null);
  if (!box) return false;
  const candidateCenterY = box.y + box.height / 2;
  const inputCenterY = anchorBox.y + anchorBox.height / 2;
  const verticalDistance = Math.abs(candidateCenterY - inputCenterY);
  const horizontallyAfterInputStart = box.x + box.width >= anchorBox.x;
  return verticalDistance <= 120 && horizontallyAfterInputStart;
}

interface ResponseSnapshot {
  count: number;
  latest: string;
}

export async function responseSnapshot(page: Page): Promise<ResponseSnapshot> {
  for (const selector of RESPONSE_SELECTORS) {
    const locator = page.locator(selector);
    const count = await locator.count().catch(() => 0);
    for (let index = count - 1; index >= 0; index -= 1) {
      const latest = await locator.nth(index).innerText().catch(() => "");
      const normalized = latest.trim();
      if (normalized) return { count: index + 1, latest: normalized };
    }
  }
  return { count: 0, latest: "" };
}

async function waitForResponse(params: {
  page: Page;
  before: ResponseSnapshot;
  timeoutMs: number;
  stableWindowMs: number;
  responsePollMs: number;
  loginCheckIntervalMs: number;
  signal: AbortSignal;
}): Promise<string> {
  const deadline = Date.now() + params.timeoutMs;
  let last = "";
  let lastChangedAt = Date.now();
  let lastLoginCheckAt = 0;
  let observedNewContent = false;

  while (Date.now() < deadline) {
    if (params.signal.aborted) {
      throw new BridgeError("request_cancelled", "Copilot request was cancelled.");
    }
    if (Date.now() - lastLoginCheckAt >= params.loginCheckIntervalMs) {
      if (!(await hasPromptInput(params.page))) {
        throw new BridgeError(
          "interactive_login_required",
          "Copilot requested interactive sign-in, MFA, consent, or CAPTCHA.",
        );
      }
      lastLoginCheckAt = Date.now();
    }

    const current = await responseSnapshot(params.page);
    const candidate = current.latest;
    const differsFromBefore =
      current.count > params.before.count ||
      candidate !== params.before.latest;
    if (candidate && differsFromBefore) observedNewContent = true;
    if (candidate !== last) {
      last = candidate;
      lastChangedAt = Date.now();
    }

    const stopVisible = Boolean(
      await firstVisible(params.page, STOP_SELECTORS),
    );
    if (
      observedNewContent &&
      last &&
      !stopVisible &&
      Date.now() - lastChangedAt >= params.stableWindowMs
    ) {
      return last;
    }
    await delay(params.responsePollMs);
  }

  throw new BridgeError(
    "copilot_timeout",
    `Copilot did not finish within ${Math.round(params.timeoutMs / 1000)} seconds.`,
  );
}

function browserTypeForEngine(engine: BridgeConfig["browserEngine"]): BrowserType {
  return engine === "webkit" ? webkit : chromium;
}

function executablePathForEngine(config: BridgeConfig): string | undefined {
  if (config.browserEngine === "webkit") return undefined;
  return config.chromiumExecutable ?? detectChromiumExecutable();
}

function detectChromiumExecutable(): string {
  const candidates = [
    process.env.CHROME_PATH,
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
    "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/snap/bin/chromium",
  ].filter((value): value is string => Boolean(value));
  const executable = candidates.find(existsSync);
  if (!executable) {
    throw new BridgeError(
      "chromium_not_found",
      "Chromium was not found. Set chromiumExecutable in config.json.",
    );
  }
  return executable;
}
