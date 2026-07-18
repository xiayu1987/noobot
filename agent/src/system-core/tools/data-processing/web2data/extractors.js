/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { browseUrlHtml } from "../../../utils/web/browser-simulate.js";
import { cleanAndDedupTextLines, extractReadableTextFromHtml, extractVisibleTextFromHtml } from "../../../utils/web/text-cleaner.js";
import { recoverableToolError } from "../../../error/index.js";
import { ERROR_CODE } from "../../../error/constants.js";
import { TOOL_DATA_MODE, TOOL_RESULT_STATUS } from "../../constants/index.js";
import { normalizeText } from "../../../utils/shared-utils.js";
import { BROWSER_RETRY_COUNT, BROWSER_SIMULATE_NETWORK_IDLE_TIMEOUT_MS, BROWSER_SIMULATE_TIMEOUT_MS, DEFAULT_CONCURRENCY, looksBlockedPage, mapWithConcurrency, resolveFetcher, tWeb } from "./utils.js";
export async function runDirectFetchExtract(
  urls = [],
  concurrency = DEFAULT_CONCURRENCY,
  runtimeContext = null,
) {
  const fetcher = resolveFetcher(runtimeContext || {});
  return mapWithConcurrency(
    urls,
    async (url) => {
      try {
        const res = await fetcher(url, {
          method: "GET",
          signal: runtimeContext?.abortSignal || undefined,
        });
        const html = await res.text();
        const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
        const pageTitle = normalizeText(titleMatch?.[1] || "");
        const readableText = extractReadableTextFromHtml(html, url);
        const fullText = extractVisibleTextFromHtml(html);
        return {
          url,
          status: res.ok ? TOOL_RESULT_STATUS.OK : TOOL_RESULT_STATUS.ERROR,
          mode: TOOL_DATA_MODE.DIRECT,
          title: pageTitle,
          usefulText: cleanAndDedupTextLines(
            `${pageTitle ? `# ${pageTitle}\n` : ""}${readableText || fullText}`,
            4000,
          ),
          fullText,
          error: res.ok ? "" : `http status ${res.status}`,
        };
      } catch (error) {
        return {
          url,
          status: TOOL_RESULT_STATUS.ERROR,
          mode: TOOL_DATA_MODE.DIRECT,
          title: "",
          usefulText: "",
          fullText: "",
          error: error?.message || String(error),
        };
      }
    },
    concurrency,
  );
}

export async function runBrowserSimulateExtract(
  urls = [],
  concurrency = DEFAULT_CONCURRENCY,
  runtimeContext = null,
) {
  return mapWithConcurrency(
    urls,
    async (url) => {
      try {
        let loaded = null;
        let success = false;
        for (let attempt = 1; attempt <= BROWSER_RETRY_COUNT + 1; attempt += 1) {
          loaded = await browseUrlHtml({
            url,
            waitUntil: "domcontentloaded",
            timeout: BROWSER_SIMULATE_TIMEOUT_MS,
            networkIdleTimeout: BROWSER_SIMULATE_NETWORK_IDLE_TIMEOUT_MS,
            runtimeContext,
          });
          const blocked = looksBlockedPage({
            status: Number(loaded?.status || 0),
            title: normalizeText(loaded?.title || ""),
            html: String(loaded?.html || ""),
            text: String(loaded?.text || ""),
          });
          if (loaded?.ok && !blocked) {
            success = true;
            break;
          }
        }
        if (!success || !loaded) {
          throw recoverableToolError(
            loaded?.error ||
              tWeb(runtimeContext || {}, "blockedOrUnavailable", {
                status: loaded?.status || 0,
              }),
            { code: ERROR_CODE.RECOVERABLE_WEB_FETCH_BLOCKED_OR_UNAVAILABLE },
          );
        }
        const pageTitle = normalizeText(loaded.title || "");
        const html = String(loaded.html || "");
        const bodyInnerText = String(loaded.text || "");
        const readableText = extractReadableTextFromHtml(html, url);
        const fullText = cleanAndDedupTextLines(bodyInnerText, 10000);
        return {
          url,
          status: TOOL_RESULT_STATUS.OK,
          mode: TOOL_DATA_MODE.BROWSER_SIMULATE,
          title: pageTitle,
          usefulText: cleanAndDedupTextLines(
            `${pageTitle ? `# ${pageTitle}\n` : ""}${readableText || fullText}`,
            4000,
          ),
          fullText,
          error: "",
        };
      } catch (error) {
        return {
          url,
          status: TOOL_RESULT_STATUS.ERROR,
          mode: TOOL_DATA_MODE.BROWSER_SIMULATE,
          title: "",
          usefulText: "",
          fullText: "",
          error: error?.message || String(error),
        };
      }
    },
    concurrency,
  );
}
