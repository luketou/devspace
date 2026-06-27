import assert from "node:assert/strict";
import test from "node:test";
import { resolveBrowserDisplay } from "./daemon.js";

test("uses local desktop browser without virtual display on macOS", async () => {
  let ensured = false;
  const display = await resolveBrowserDisplay(
    { headless: false, display: ":99" },
    {
      async ensureDisplay() {
        ensured = true;
        return ":99";
      },
    },
    {},
    "darwin",
  );

  assert.equal(display, undefined);
  assert.equal(ensured, false);
});

test("keeps virtual display behavior for Linux desktop browser mode", async () => {
  const display = await resolveBrowserDisplay(
    { headless: false, display: ":99" },
    {
      async ensureDisplay() {
        return ":99";
      },
    },
    {},
    "linux",
  );

  assert.equal(display, ":99");
});

test("preserves existing DISPLAY when present", async () => {
  const display = await resolveBrowserDisplay(
    { headless: false, display: ":99" },
    {
      async ensureDisplay() {
        throw new Error("should not start a virtual display");
      },
    },
    { DISPLAY: ":1" },
    "darwin",
  );

  assert.equal(display, ":1");
});
