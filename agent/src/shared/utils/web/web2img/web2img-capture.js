/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { preparePageForCapture } from "./web2img-interact.js";

async function capturePageScreenshot(page, rawImagePath, screenshotOptions = {}) {
  const fullPage = screenshotOptions.fullPage ?? true;
  await page.screenshot({ path: rawImagePath, fullPage });
  return rawImagePath;
}

async function navigateAndCapture({
  page,
  url,
  rawImagePath,
  expandPatterns,
  runtimeDefaults,
  screenshotOptions = {},
}) {
  await page.goto(url, {
    waitUntil: "domcontentloaded",
    timeout: runtimeDefaults.page.gotoTimeoutMs,
  });

  await preparePageForCapture(page, expandPatterns, runtimeDefaults);
  await capturePageScreenshot(page, rawImagePath, screenshotOptions);
}

export {
  capturePageScreenshot,
  navigateAndCapture,
};
