import type { Page } from "playwright-core";
import type {
  EffectiveMode,
  ModeSelectionResult,
  PreferredMode,
} from "./protocol.js";

const MODEL_SELECTOR_NAME = "Model Selector";
const MODE_LABELS: Record<PreferredMode, string> = {
  think_deeper: "Think Deeper",
  auto: "Auto",
};
const MODE_SELECTION_TIMEOUT_MS = 3000;

export async function ensurePreferredMode(
  page: Page,
  requestedMode: PreferredMode,
): Promise<ModeSelectionResult> {
  const selector = page.getByRole("button", { name: MODEL_SELECTOR_NAME });
  try {
    await selector.waitFor({
      state: "visible",
      timeout: MODE_SELECTION_TIMEOUT_MS,
    });
    const initial = normalizeMode(await selector.innerText());
    if (initial === requestedMode) {
      return {
        requestedMode,
        effectiveMode: initial,
        fallbackUsed: false,
      };
    }

    if (await selectAndVerify(page, selector, requestedMode)) {
      return {
        requestedMode,
        effectiveMode: requestedMode,
        fallbackUsed: false,
      };
    }

    const autoSelected = await selectAndVerify(page, selector, "auto");
    return {
      requestedMode,
      effectiveMode: autoSelected
        ? "auto"
        : normalizeMode(await safeText(selector)),
      fallbackUsed: requestedMode !== "auto",
      modeWarning: `Unable to select ${MODE_LABELS[requestedMode]}; continuing with Auto when available.`,
    };
  } catch (error) {
    return {
      requestedMode,
      effectiveMode: "unknown",
      fallbackUsed: requestedMode !== "auto",
      modeWarning: `Model selector unavailable: ${messageFor(error)}`,
    };
  }
}

async function selectAndVerify(
  page: Page,
  selector: ReturnType<Page["getByRole"]>,
  mode: PreferredMode,
): Promise<boolean> {
  try {
    await selector.click();
    const option = page.getByText(MODE_LABELS[mode], { exact: true }).last();
    await option.waitFor({
      state: "visible",
      timeout: MODE_SELECTION_TIMEOUT_MS,
    });
    await option.click();
    return normalizeMode(await selector.innerText()) === mode;
  } catch {
    return false;
  }
}

function normalizeMode(label: string): EffectiveMode {
  const normalized = label.trim();
  if (normalized === MODE_LABELS.think_deeper) return "think_deeper";
  if (normalized === MODE_LABELS.auto) return "auto";
  return "unknown";
}

async function safeText(
  locator: ReturnType<Page["getByRole"]>,
): Promise<string> {
  return locator.innerText().catch(() => "");
}

function messageFor(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
