import assert from "node:assert/strict";
import test from "node:test";
import type { Page } from "playwright-core";
import { responseSnapshot } from "./browser.js";

function pageWithTextBySelector(values: Record<string, string[]>): Page {
  return {
    locator(selector: string) {
      const texts = values[selector] ?? [];
      return {
        async count() {
          return texts.length;
        },
        nth(index: number) {
          return {
            async innerText() {
              return texts[index] ?? "";
            },
          };
        },
      };
    },
  } as unknown as Page;
}

test("responseSnapshot reads current Microsoft 365 markdown replies", async () => {
  const page = pageWithTextBySelector({
    '[data-testid="markdown-reply"]': ["DOM_BRIDGE_CAPTURE_8271"],
  });

  assert.deepEqual(await responseSnapshot(page), {
    count: 1,
    latest: "DOM_BRIDGE_CAPTURE_8271",
  });
});
