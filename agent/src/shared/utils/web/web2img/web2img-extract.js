/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { tSystem } from "noobot-i18n/agent/system-text";
import { extractReadableLinesFromHtml } from "../text-cleaner.js";
import { HAS_READABILITY } from "./web2img-config.js";
import { cleanAndDedupLines } from "./web2img-clean.js";
import { extractOrderedSegments, segmentsToMarkdown } from "./web2img-ordered.js";
import { LENGTH_THRESHOLDS } from "@noobot/shared/length-thresholds";
import { QUANTITY_THRESHOLDS } from "@noobot/shared/quantity-thresholds";

async function extractUsefulAndFullText(page, adPatterns, preferTrafilatura = true) {
  const title = String((await page.title()) || "").trim();

  let desc = "";
  try {
    desc = (await page.locator('meta[name="description"]').first().getAttribute("content")) || "";
  } catch {
    desc = "";
  }
  desc = String(desc || "").trim();

  const orderedSegments = await extractOrderedSegments(page, 8000);
  const orderedMd = segmentsToMarkdown(
    orderedSegments,
    adPatterns,
    LENGTH_THRESHOLDS.dataProcessing.web2ImgUsefulTextChars,
  );

  let trafiLines = [];
  if (preferTrafilatura && HAS_READABILITY) {
    try {
      const html = await page.content();
      trafiLines = extractReadableLinesFromHtml(html, {
        urlValue: page.url(),
        maxLines: QUANTITY_THRESHOLDS.web.readableExtractMaxLines,
        extraNoisePatterns: adPatterns,
      });
    } catch {
      trafiLines = [];
    }
  }

  const usefulParts = [];
  if (title) usefulParts.push(`# ${title}`);
  if (desc) usefulParts.push(`\n${tSystem("web2img.descriptionLabel")}：${desc}`);

  usefulParts.push(`\n## ${tSystem("web2img.mainContentTitle")}`);
  usefulParts.push(orderedMd.trim() ? orderedMd : `[${tSystem("web2img.noContentExtracted")}]`);

  usefulParts.push(`\n## ${tSystem("web2img.textCleanAppendixTitle")}`);
  if (trafiLines.length) usefulParts.push(...trafiLines);
  else usefulParts.push(`[${tSystem("web2img.noReadableTextExtracted")}]`);

  let usefulText = `${usefulParts.join("\n").trim()}\n`;

  let fullText = "";
  try {
    fullText = (await page.evaluate(() => document.body?.innerText || "")) || "";
  } catch {
    fullText = "";
  }

  let fullLines = fullText
    .split(/\r?\n/)
    .map((lineText) => lineText.trim())
    .filter(Boolean);
  fullLines = cleanAndDedupLines(fullLines, adPatterns, 0.96);
  fullText = `${fullLines.join("\n").trim()}\n`;

  if (orderedMd.trim()) {
    fullText += `\n\n[ORDERED_CONTENT]\n${orderedMd}`;
  }

  if (usefulText.length > LENGTH_THRESHOLDS.dataProcessing.web2ImgUsefulTextChars) {
    usefulText = `${usefulText.slice(0, LENGTH_THRESHOLDS.dataProcessing.web2ImgUsefulTextChars)}\n\n[${tSystem("web2img.contentTruncated")}]\n`;
  }
  if (fullText.length > LENGTH_THRESHOLDS.dataProcessing.web2ImgFullTextChars) {
    fullText = `${fullText.slice(0, LENGTH_THRESHOLDS.dataProcessing.web2ImgFullTextChars)}\n\n[${tSystem("web2img.contentTruncated")}]\n`;
  }

  return [usefulText, fullText];
}

export {
  extractUsefulAndFullText,
};
