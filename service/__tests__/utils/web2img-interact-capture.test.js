/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";

import { preparePageForCapture } from "../../system-core/utils/web/web2img/web2img-interact.js";
import {
  capturePageScreenshot,
  navigateAndCapture,
} from "../../system-core/utils/web/web2img/web2img-capture.js";

function createMockPage(callLog) {
  return {
    async goto(url, options) {
      callLog.push(["goto", url, options?.waitUntil]);
    },
    async waitForLoadState(state) {
      callLog.push(["waitForLoadState", state]);
    },
    async waitForFunction() {
      callLog.push(["waitForFunction"]);
    },
    async waitForTimeout(ms) {
      callLog.push(["waitForTimeout", ms]);
    },
    locator() {
      return {
        async count() {
          return 0;
        },
      };
    },
    async evaluate() {
      callLog.push(["evaluate"]);
      return 0;
    },
    async screenshot(options) {
      callLog.push(["screenshot", options?.path, options?.fullPage]);
    },
  };
}

const runtimeDefaults = {
  page: {
    loadTimeoutMs: 1,
    readyStateTimeoutMs: 1,
    networkIdleTimeoutMs: 1,
    readyPostWaitMs: 1,
    gotoTimeoutMs: 1,
  },
  expand: {
    maxMatchCount: 0,
    visibleTimeoutMs: 1,
    clickTimeoutMs: 1,
    postClickWaitMs: 1,
  },
  scroll: {
    maxSteps: 0,
    stepPx: 100,
    waitMs: 1,
    finalTopWaitMs: 1,
  },
  textStable: {
    rounds: 0,
    intervalMs: 1,
    stableThreshold: 1,
  },
};

test("web2img interact: preparePageForCapture executes without expand/scroll rounds", async () => {
  const calls = [];
  const page = createMockPage(calls);
  await preparePageForCapture(page, [], runtimeDefaults);

  assert.ok(calls.some((item) => item[0] === "waitForLoadState" && item[1] === "load"));
  assert.ok(calls.some((item) => item[0] === "waitForFunction"));
});

test("web2img capture: capturePageScreenshot defaults fullPage=true", async () => {
  const calls = [];
  const page = createMockPage(calls);
  await capturePageScreenshot(page, "/tmp/mock.png");

  const screenshotCall = calls.find((item) => item[0] === "screenshot");
  assert.deepEqual(screenshotCall, ["screenshot", "/tmp/mock.png", true]);
});

test("web2img capture: navigateAndCapture calls goto and screenshot", async () => {
  const calls = [];
  const page = createMockPage(calls);

  await navigateAndCapture({
    page,
    url: "https://example.com",
    rawImagePath: "/tmp/mock2.png",
    expandPatterns: [],
    runtimeDefaults,
  });

  assert.ok(calls.some((item) => item[0] === "goto" && item[1] === "https://example.com"));
  assert.ok(calls.some((item) => item[0] === "screenshot" && item[1] === "/tmp/mock2.png"));
});
