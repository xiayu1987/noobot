/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { Readability } from "@mozilla/readability";
import { JSDOM } from "jsdom";

const MIN_TAG_TEXT_LENGTH = 6;

function normalizeText(value = "") {
  return String(value || "").replace(/\s+/g, " ").trim();
}

export function cleanAndDedupTextLines(input = "", maxLines = 4000) {
  const out = [];
  const seen = new Set();
  const lines = String(input || "")
    .split(/\r?\n/)
    .map((line) => normalizeText(line))
    .filter(Boolean);
  for (const line of lines) {
    if (line.length <= 1) continue;
    if (seen.has(line)) continue;
    seen.add(line);
    out.push(line);
    if (out.length >= maxLines) break;
  }
  return out.join("\n");
}

function removeNoiseNodes(doc) {
  const selectors = [
    "script",
    "style",
    "noscript",
    "template",
    "svg",
    "canvas",
    "iframe",
    "head",
    "meta",
    "link",
    "nav",
    "header",
    "footer",
    "aside",
    "[role='navigation']",
    "[role='banner']",
    "[role='contentinfo']",
    "[class*='ad']",
    "[class*='ads']",
    "[class*='advert']",
    "[class*='sponsor']",
    "[class*='promo']",
    "[class*='banner']",
    "[class*='pop']",
    "[class*='cookie']",
    "[class*='subscribe']",
    "[class*='recommend']",
    "[id*='ad']",
    "[id*='ads']",
    "[id*='advert']",
    "[id*='sponsor']",
    "[id*='promo']",
    "[id*='banner']",
    "[id*='popup']",
    "[id*='cookie']",
    ".advertisement",
    ".ads",
    ".sponsor",
  ];
  for (const node of doc.querySelectorAll(selectors.join(","))) {
    node.remove();
  }
}

function removeShortTextNodes(doc, minLength = MIN_TAG_TEXT_LENGTH) {
  const targets = doc.querySelectorAll(
    "p,span,a,li,td,th,label,button,strong,em,b,i,small,time,figcaption,summary,dd,dt,blockquote,code,pre,h1,h2,h3,h4,h5,h6,div",
  );
  for (let i = targets.length - 1; i >= 0; i -= 1) {
    const node = targets[i];
    if (!node || node.children?.length > 0) continue; // 只清理叶子节点，避免误删正文容器
    const text = normalizeText(node.textContent || "");
    if (!text || text.length < minLength) {
      node.remove();
    }
  }
}

function aggressiveCleanText(input = "", maxLines = 4000) {
  const noisePatterns = [
    /^(广告|推广|赞助|相关推荐|猜你想看|猜你喜欢|热搜|热门推荐)$/i,
    /(cookie|隐私政策|隐私声明|用户协议|订阅|注册|登录|打开app|下载app)/i,
    /(上一页|下一页|返回首页|返回顶部|点击展开|点击收起)/i,
    /(版权所有|copyright|all rights reserved)/i,
  ];
  const lines = String(input || "")
    .split(/\r?\n/)
    .map((line) => normalizeText(line))
    .filter(Boolean)
    .filter((line) => line.length >= 2)
    .filter((line) => !noisePatterns.some((p) => p.test(line)));
  return cleanAndDedupTextLines(lines.join("\n"), maxLines);
}

export function extractVisibleTextFromHtml(html = "") {
  try {
    const dom = new JSDOM(String(html || ""));
    const doc = dom.window.document;
    removeNoiseNodes(doc);
    removeShortTextNodes(doc);
    return aggressiveCleanText(doc?.body?.textContent || "", 10000);
  } catch {
    return "";
  }
}

export function extractReadableTextFromHtml(html = "", urlValue = "") {
  try {
    const dom = new JSDOM(String(html || ""), {
      url: urlValue || "https://example.com/",
    });
    removeNoiseNodes(dom.window.document);
    removeShortTextNodes(dom.window.document);
    const reader = new Readability(dom.window.document);
    const parsed = reader.parse();
    return aggressiveCleanText(parsed?.textContent || "", 5000);
  } catch {
    return "";
  }
}
