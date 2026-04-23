/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { chromium } from "playwright";

const DEFAULT_USER_AGENT =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36";

export async function browseUrlHtml({
  url = "",
  waitUntil = "load",
  timeout = 30000,
  networkIdleTimeout = 12000,
} = {}) {
  const targetUrl = String(url || "").trim();
  if (!/^https?:\/\//i.test(targetUrl)) {
    return {
      ok: false,
      status: 0,
      finalUrl: targetUrl,
      title: "",
      html: "",
      text: "",
      error: "invalid url",
    };
  }
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({
      viewport: { width: 1366, height: 900 },
      userAgent: DEFAULT_USER_AGENT,
      ignoreHTTPSErrors: true,
      locale: "zh-CN",
      extraHTTPHeaders: {
        Accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
      },
    });
    try {
      const page = await context.newPage();
      try {
        const response = await page.goto(targetUrl, {
          waitUntil,
          timeout,
        });
        await page
          .waitForFunction(() => document.readyState === "complete", null, {
            timeout: Math.min(timeout, 20000),
          })
          .catch(() => {});
        try {
          await page.waitForLoadState("networkidle", {
            timeout: networkIdleTimeout,
          });
        } catch {}
        await page.waitForTimeout(1000);
        return {
          ok: true,
          status: Number(response?.status?.() || 0),
          finalUrl: page.url(),
          title: await page.title(),
          html: await page.content(),
          text: await page.evaluate(() => document.body?.innerText || ""),
          error: "",
        };
      } finally {
        await page.close().catch(() => {});
      }
    } finally {
      await context.close().catch(() => {});
    }
  } catch (error) {
    return {
      ok: false,
      status: 0,
      finalUrl: targetUrl,
      title: "",
      html: "",
      text: "",
      error: error?.message || String(error),
    };
  } finally {
    await browser.close().catch(() => {});
  }
}
