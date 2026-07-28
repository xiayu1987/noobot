/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { tSystem } from "noobot-i18n/agent/system-text";
import { prepareAdPatternMatchers, isNoiseOrAdLine } from "./web2img-clean.js";
import { LENGTH_THRESHOLDS } from "@noobot/shared/length-thresholds";

async function extractOrderedSegments(page, maxItems = 8000) {
  const js = `
() => {
  const visible = (elementNode) => {
    if (!elementNode) return false;
    const computedStyle = getComputedStyle(elementNode);
    if (!computedStyle) return true;
    if (computedStyle.display === "none" || computedStyle.visibility === "hidden") return false;
    const boundingRect = elementNode.getBoundingClientRect();
    return boundingRect.width > 0 && boundingRect.height > 0;
  };

  const normalizeText = (textValue) => (textValue || "").replace(/\\r/g, "").replace(/\\u00a0/g, " ").trim();

  const detectLang = (elementNode) => {
    const classLanguageText = (elementNode.className || "") + " " + (elementNode.getAttribute("data-language") || "");
    const langMatch = classLanguageText.match(/(?:language|lang)[-_:]?([a-zA-Z0-9#+.-]+)/i);
    return langMatch && langMatch[1] ? langMatch[1].toLowerCase() : "";
  };

  const pickRoot = () => {
    const candidates = [
      "article",
      "main",
      "[role='main']",
      ".markdown-body",
      ".post-content",
      ".entry-content",
      ".article-content",
      ".content"
    ];

    let best = null;
    let bestScore = -1;

    for (const selectorText of candidates) {
      for (const elementNode of document.querySelectorAll(selectorText)) {
        if (!visible(elementNode)) continue;
        const textLength = (elementNode.innerText || "").length;
        const codeBlockCount = elementNode.querySelectorAll("pre, code").length;
        const score = textLength + codeBlockCount * 300;
        if (score > bestScore) {
          best = elementNode;
          bestScore = score;
        }
      }
    }

    if (best && bestScore > 500) return best;
    return document.body || document.documentElement;
  };

  const root = pickRoot();

  const isInNoiseArea = (elementNode) => {
    if (!root.contains(elementNode)) return true;
    return !!elementNode.closest("nav, footer, aside, form, noscript, script, style, .sidebar, .recommend, .related");
  };

  const nodes = root.querySelectorAll("h1,h2,h3,h4,h5,h6,p,li,blockquote,pre,code");
  const out = [];
  const seen = new Set();

  for (const elementNode of nodes) {
    if (!visible(elementNode)) continue;
    if (isInNoiseArea(elementNode)) continue;

    const tag = (elementNode.tagName || "").toLowerCase();

    if (tag === "pre") {
      const text = normalizeText(elementNode.innerText || elementNode.textContent || "");
      if (!text) continue;

      let lang = detectLang(elementNode);
      const codeElement = elementNode.querySelector("code");
      if (!lang && codeElement) lang = detectLang(codeElement);

      const key = "C:" + text.replace(/\\s+/g, "").slice(0, 500);
      if (seen.has(key)) continue;
      seen.add(key);

      out.push({type: "code", lang, text});
      continue;
    }

    if (tag === "code") {
      if (elementNode.closest("pre")) continue;
      const text = normalizeText(elementNode.innerText || elementNode.textContent || "");
      if (!text) continue;

      const looksCode = /[{}();=<>[\\].:+\\-_*\\/\\\\]|import |def |class |function |SELECT |FROM |WHERE/i.test(text);
      if (text.length < 20 && !looksCode) continue;

      const key = "C:" + text.replace(/\\s+/g, "").slice(0, 500);
      if (seen.has(key)) continue;
      seen.add(key);

      out.push({type: "code", lang: detectLang(elementNode), text});
      continue;
    }

    const text = normalizeText(elementNode.innerText || elementNode.textContent || "");
    if (!text || text.length < 2) continue;

    let line = text;
    if (tag === "li") line = "- " + line;
    else if (/^h[1-6]$/.test(tag)) line = "### " + line;

    const key = "T:" + line.replace(/\\s+/g, " ").slice(0, 260);
    if (seen.has(key)) continue;
    seen.add(key);

    out.push({type: "text", text: line});
  }

  return out;
}
`;

  let segs = [];
  try {
    segs = (await page.evaluate(js)) || [];
  } catch {
    segs = [];
  }

  const out = [];
  for (const segmentItem of segs) {
    if (!segmentItem || typeof segmentItem !== "object") continue;
    const segmentType = String(segmentItem.type || "").trim();
    if (segmentType === "code") {
      const text = String(segmentItem.text || "").replace(/^\n+|\n+$/g, "");
      if (text.length < 8) continue;
      out.push({ type: "code", lang: String(segmentItem.lang || "").trim(), text });
    } else if (segmentType === "text") {
      const normalizedText = String(segmentItem.text || "").replace(/\s+/g, " ").trim();
      if (!normalizedText) continue;
      out.push({ type: "text", text: normalizedText });
    }
    if (out.length >= maxItems) break;
  }
  return out;
}

function segmentsToMarkdown(
  segments,
  adPatterns,
  maxChars = LENGTH_THRESHOLDS.dataProcessing.web2ImgUsefulTextChars,
) {
  const parts = [];
  let total = 0;
  let prevKey = "";
  const adPatternMatchers = prepareAdPatternMatchers(adPatterns);

  for (const seg of segments || []) {
    let chunk = "";
    if (seg.type === "text") {
      if (isNoiseOrAdLine(seg.text, adPatterns, adPatternMatchers)) continue;
      chunk = `${seg.text}\n`;
    } else {
      const lang = String(seg.lang || "").trim();
      const txt = String(seg.text || "").replace(/\s+$/g, "");
      chunk = `\`\`\`${lang}\n${txt}\n\`\`\`\n`;
    }

    const key = chunk.trim().replace(/\s+/g, " ");
    if (key && key === prevKey) continue;
    prevKey = key;

    if (total + chunk.length > maxChars) {
      parts.push(`\n[${tSystem("web2img.contentTruncated")}]\n`);
      break;
    }

    parts.push(chunk);
    total += chunk.length;
  }

  return `${parts.join("").trim()}\n`;
}

export {
  extractOrderedSegments,
  segmentsToMarkdown,
};
