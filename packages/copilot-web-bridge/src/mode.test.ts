import assert from "node:assert/strict";
import test from "node:test";
import type { Locator, Page } from "playwright-core";
import { ensurePreferredMode } from "./mode.js";

function fakePage(params: {
  selected: string;
  options?: string[];
  selectorVisible?: boolean;
  selectionPersists?: boolean;
}): Page {
  let selected = params.selected;
  const selectorVisible = params.selectorVisible ?? true;
  const options = new Set(params.options ?? ["Auto", "Think Deeper"]);
  const selector = {
    async waitFor() {
      if (!selectorVisible) throw new Error("selector unavailable");
    },
    async innerText() {
      if (!selectorVisible) throw new Error("selector unavailable");
      return selected;
    },
    async click() {},
  } as unknown as Locator;

  return {
    getByRole(role: string, query: { name?: string }) {
      assert.equal(role, "button");
      assert.equal(query.name, "Model Selector");
      return selector;
    },
    getByText(text: string, _options?: { exact?: boolean }) {
      return {
        last() {
          return {
            async waitFor() {
              if (!options.has(text)) throw new Error("option unavailable");
            },
            async click() {
              if (params.selectionPersists !== false) selected = text;
            },
          } as unknown as Locator;
        },
      } as unknown as Locator;
    },
  } as unknown as Page;
}

test("keeps Think Deeper when it is already selected", async () => {
  const result = await ensurePreferredMode(
    fakePage({ selected: "Think Deeper" }),
    "think_deeper",
  );
  assert.deepEqual(result, {
    requestedMode: "think_deeper",
    effectiveMode: "think_deeper",
    fallbackUsed: false,
  });
});

test("switches Auto to Think Deeper", async () => {
  const result = await ensurePreferredMode(
    fakePage({ selected: "Auto" }),
    "think_deeper",
  );
  assert.equal(result.effectiveMode, "think_deeper");
  assert.equal(result.fallbackUsed, false);
});

test("falls back to Auto when Think Deeper is unavailable", async () => {
  const result = await ensurePreferredMode(
    fakePage({ selected: "Auto", options: ["Auto"] }),
    "think_deeper",
  );
  assert.equal(result.effectiveMode, "auto");
  assert.equal(result.fallbackUsed, true);
  assert.match(result.modeWarning ?? "", /Think Deeper/);
});

test("reports unknown when the selector is unavailable", async () => {
  const result = await ensurePreferredMode(
    fakePage({ selected: "Auto", selectorVisible: false }),
    "think_deeper",
  );
  assert.equal(result.effectiveMode, "unknown");
  assert.equal(result.fallbackUsed, true);
});

test("falls back to Auto when Think Deeper does not persist", async () => {
  const result = await ensurePreferredMode(
    fakePage({ selected: "Auto", selectionPersists: false }),
    "think_deeper",
  );
  assert.equal(result.effectiveMode, "auto");
  assert.equal(result.fallbackUsed, true);
});
