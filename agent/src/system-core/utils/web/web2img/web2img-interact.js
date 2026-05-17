/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

function escapeRegex(textValue) {
  return String(textValue || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function waitPageReady(page, runtimeDefaults) {
  const pageCfg = runtimeDefaults.page;
  await page.waitForLoadState("load", {
    timeout: pageCfg.loadTimeoutMs,
  });
  await page.waitForFunction(
    () => document.readyState === "complete",
    null,
    { timeout: pageCfg.readyStateTimeoutMs },
  );
  try {
    await page.waitForLoadState("networkidle", {
      timeout: pageCfg.networkIdleTimeoutMs,
    });
  } catch {
    // Some sites keep long-polling connections; timeout is acceptable here.
  }
  await page.waitForTimeout(pageCfg.readyPostWaitMs);
}

async function tryExpandContent(page, patterns, runtimeDefaults) {
  const expandCfg = runtimeDefaults.expand;
  for (const kw of patterns || []) {
    try {
      const loc = page.locator(`text=/${escapeRegex(kw)}/i`);
      const itemCount = Math.min(await loc.count(), expandCfg.maxMatchCount);
      for (let itemIndex = 0; itemIndex < itemCount; itemIndex++) {
        try {
          const targetElement = loc.nth(itemIndex);
          if (await targetElement.isVisible({ timeout: expandCfg.visibleTimeoutMs })) {
            await targetElement.click({ timeout: expandCfg.clickTimeoutMs });
            await page.waitForTimeout(expandCfg.postClickWaitMs);
          }
        } catch {
          // Ignore per-element click failures and continue expanding other candidates.
        }
      }
    } catch {
      // Ignore selector/query failures for this keyword; continue with next keyword.
    }
  }
}

async function autoScroll(page, runtimeDefaults) {
  const scrollCfg = runtimeDefaults.scroll;
  let lastH = 0;
  for (let stepIndex = 0; stepIndex < scrollCfg.maxSteps; stepIndex++) {
    await page.evaluate((sp) => window.scrollBy(0, sp), scrollCfg.stepPx);
    await page.waitForTimeout(scrollCfg.waitMs);
    let scrollHeight = await page.evaluate(() => (document.body ? document.body.scrollHeight : 0));
    if (scrollHeight <= lastH) {
      await page.waitForTimeout(scrollCfg.waitMs);
      const h2 = await page.evaluate(() => (document.body ? document.body.scrollHeight : 0));
      if (h2 <= scrollHeight) break;
      scrollHeight = h2;
    }
    lastH = scrollHeight;
  }
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(scrollCfg.finalTopWaitMs);
}

async function waitTextStable(page, runtimeDefaults) {
  const stableCfg = runtimeDefaults.textStable;
  let stable = 0;
  let lastLen = -1;

  for (let roundIndex = 0; roundIndex < stableCfg.rounds; roundIndex++) {
    const curLen = await page.evaluate(() => (document.body?.innerText || "").length);
    if (curLen === lastLen) {
      stable++;
      if (stable >= stableCfg.stableThreshold) break;
    } else {
      stable = 0;
      lastLen = curLen;
    }
    await page.waitForTimeout(stableCfg.intervalMs);
  }
}

async function preparePageForCapture(page, expandPatterns, runtimeDefaults) {
  await waitPageReady(page, runtimeDefaults);
  await tryExpandContent(page, expandPatterns, runtimeDefaults);
  await autoScroll(page, runtimeDefaults);
  await waitTextStable(page, runtimeDefaults);
}

export {
  waitPageReady,
  tryExpandContent,
  autoScroll,
  waitTextStable,
  preparePageForCapture,
};
