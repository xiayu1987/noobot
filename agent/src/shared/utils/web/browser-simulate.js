/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { chromium } from "playwright";
import { tSystem } from "noobot-i18n/agent/system-text";
import { logger } from "../../../observability/index.js";
import { runBestEffort } from "@noobot/shared/best-effort";
import { normalizeTimeMs } from "@noobot/agent-config-protocol";
import { TIME_THRESHOLDS } from "@noobot/shared/time-thresholds";

const DEFAULT_USER_AGENT =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
const BLOCKED_RESOURCE_TYPES = new Set(["image", "media", "font", "other"]);
const TRACKING_HOST_PATTERNS = [
  /doubleclick\.net$/i,
  /googlesyndication\.com$/i,
  /google-analytics\.com$/i,
  /googletagmanager\.com$/i,
  /facebook\.com$/i,
  /hotjar\.com$/i,
  /clarity\.ms$/i,
];

let sharedBrowser = null;
let launchPromise = null;

function getRuntimeBrowserStore(runtimeContext = null) {
  if (!runtimeContext || typeof runtimeContext !== "object") return null;
  if (!runtimeContext.__webBrowserStore) {
    runtimeContext.__webBrowserStore = {
      browser: null,
      launchPromise: null,
    };
  }
  return runtimeContext.__webBrowserStore;
}

async function getSharedBrowser(runtimeContext = null) {
  const runtimeStore = getRuntimeBrowserStore(runtimeContext);
  if (runtimeStore?.browser) return runtimeStore.browser;
  if (runtimeStore?.launchPromise) return runtimeStore.launchPromise;
  if (sharedBrowser) return sharedBrowser;
  if (!launchPromise) {
    launchPromise = chromium
      .launch({
        headless: true,
        args: ["--disable-blink-features=AutomationControlled", "--no-default-browser-check"],
      })
      .then((browser) => {
        sharedBrowser = browser;
        return browser;
      })
      .finally(() => {
        launchPromise = null;
      });
  }
  if (!runtimeStore) return launchPromise;
  runtimeStore.launchPromise = launchPromise;
  return runtimeStore.launchPromise.then((browser) => {
    runtimeStore.browser = browser;
    runtimeStore.launchPromise = null;
    return browser;
  });
}

export async function initRuntimeSharedBrowser(runtimeContext = null) {
  const browser = await getSharedBrowser(runtimeContext);
  if (runtimeContext && typeof runtimeContext === "object") {
    runtimeContext.sharedTools =
      runtimeContext.sharedTools && typeof runtimeContext.sharedTools === "object"
        ? runtimeContext.sharedTools
        : {};
    runtimeContext.sharedTools.browser = browser;
  }
  return browser;
}

function shouldBlockRequest(request) {
  const type = String(request.resourceType() || "").toLowerCase();
  if (BLOCKED_RESOURCE_TYPES.has(type)) return true;
  try {
    const host = new URL(request.url()).hostname.toLowerCase();
    return TRACKING_HOST_PATTERNS.some((pattern) => pattern.test(host));
  } catch {
    return false;
  }
}

async function waitForPlaywrightState(action) {
  try {
    await action();
  } catch (error) {
    if (error?.name !== "TimeoutError") throw error;
  }
}

export async function browseUrlHtml({
  url = "",
  waitUntil = "domcontentloaded",
  timeout = TIME_THRESHOLDS.web.browserDefaultTimeoutMs,
  networkIdleTimeout = TIME_THRESHOLDS.web.browserNetworkIdleTimeoutMs,
  runtimeContext = null,
} = {}) {
  const resolvedTimeoutMs = normalizeTimeMs(timeout, {
    fallback: TIME_THRESHOLDS.web.browserDefaultTimeoutMs,
    min: 1000,
  });
  const resolvedNetworkIdleTimeoutMs = normalizeTimeMs(networkIdleTimeout, {
    fallback: TIME_THRESHOLDS.web.browserNetworkIdleTimeoutMs,
    min: 500,
  });
  const targetUrl = String(url || "").trim();
  if (!/^https?:\/\//i.test(targetUrl)) {
    return {
      ok: false,
      status: 0,
      finalUrl: targetUrl,
      title: "",
      html: "",
      text: "",
      error: tSystem("common.invalidUrl"),
    };
  }
  const browser = await initRuntimeSharedBrowser(runtimeContext);
  try {
    const context = await browser.newContext({
      viewport: { width: 1366, height: 900 },
      userAgent: DEFAULT_USER_AGENT,
      ignoreHTTPSErrors: true,
      locale: "zh-CN",
      timezoneId: "Asia/Shanghai",
      colorScheme: "light",
      extraHTTPHeaders: {
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
        "Upgrade-Insecure-Requests": "1",
      },
    });
    try {
      await context.addInitScript(() => {
        Object.defineProperty(navigator, "webdriver", {
          get: () => undefined,
        });
      });
      const page = await context.newPage();
      try {
        await page.route("**/*", (route) => {
          if (shouldBlockRequest(route.request())) {
            return runBestEffort(() => route.abort(), {
              operationName: "browserSimulation.abortRoute",
              context: { targetUrl },
            });
          }
          return runBestEffort(() => route.continue(), {
            operationName: "browserSimulation.continueRoute",
            context: { targetUrl },
          });
        });
        const response = await page.goto(targetUrl, {
          waitUntil,
          timeout: resolvedTimeoutMs,
        });
        await waitForPlaywrightState(() =>
          page.waitForFunction(() => document.readyState === "complete", null, {
            timeout: Math.min(resolvedTimeoutMs, 20000),
          }),
        );
        await waitForPlaywrightState(() =>
          page.waitForLoadState("networkidle", {
            timeout: resolvedNetworkIdleTimeoutMs,
          }),
        );
        await page.waitForTimeout(300);
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
        await runBestEffort(() => page.close(), {
          operationName: "browserSimulation.closePage",
          context: { targetUrl },
        });
      }
    } finally {
      await runBestEffort(() => context.close(), {
        operationName: "browserSimulation.closeContext",
        context: { targetUrl },
      });
    }
  } catch (error) {
    logger.error(`[browseUrlHtml] ${targetUrl} failed: ${error?.message || String(error)}`);
    return {
      ok: false,
      status: 0,
      finalUrl: targetUrl,
      title: "",
      html: "",
      text: "",
      error: error?.message || String(error),
    };
  }
}

async function closeSharedBrowser() {
  if (!sharedBrowser) return;
  const current = sharedBrowser;
  sharedBrowser = null;
  await runBestEffort(() => current.close(), {
    operationName: "browserSimulation.closeSharedBrowser",
  });
}

process.on("exit", () => {
  if (sharedBrowser) {
    void runBestEffort(() => sharedBrowser.close(), {
      operationName: "browserSimulation.closeSharedBrowserOnExit",
    });
    sharedBrowser = null;
  }
});
process.on("SIGINT", () => {
  void runBestEffort(closeSharedBrowser, {
    operationName: "browserSimulation.closeSharedBrowserOnSigint",
  }).finally(() => process.exit(130));
});
process.on("SIGTERM", () => {
  void runBestEffort(closeSharedBrowser, {
    operationName: "browserSimulation.closeSharedBrowserOnSigterm",
  }).finally(() => process.exit(143));
});
