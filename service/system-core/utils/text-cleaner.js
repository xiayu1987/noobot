/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  extractReadableTextFromHtml,
  extractVisibleTextFromHtml,
} from "./web-text-cleaner.js";

const NOISE_PATTERNS = [
  /^(广告|推广|赞助|相关推荐|猜你想看|猜你喜欢|热门推荐|热搜)$/i,
  /(cookie|隐私政策|隐私声明|用户协议|免责声明|版权声明)/i,
  /(登录|注册|下载app|打开app|关注我们|扫码|返回顶部|上一页|下一页)/i,
  /(all rights reserved|copyright)/i,
];

function normalizeWhitespace(input = "") {
  return String(input || "")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, " ")
    .replace(/\u00A0/g, " ")
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function postCleanText(input = "", maxChars = 120000) {
  const clipped = String(input || "").slice(0, Math.max(0, maxChars));
  const lines = normalizeWhitespace(clipped)
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => line.length >= 2)
    .filter((line) => !NOISE_PATTERNS.some((p) => p.test(line)));

  const out = [];
  const seen = new Set();
  for (const line of lines) {
    if (seen.has(line)) continue;
    seen.add(line);
    out.push(line);
    if (out.join("\n").length >= maxChars) break;
  }
  return normalizeWhitespace(out.join("\n"));
}

function cleanPlainText(input = "", maxChars = 120000) {
  return postCleanText(input, maxChars);
}

function cleanMarkdownText(input = "", maxChars = 120000) {
  const raw = String(input || "")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/!\[[^\]]*]\([^)]+\)/g, " ")
    .replace(/\[([^\]]+)]\([^)]+\)/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^>\s?/gm, "")
    .replace(/^\s*[-*+]\s+/gm, "")
    .replace(/^\s*\d+\.\s+/gm, "");
  return cleanPlainText(raw, maxChars);
}

function cleanHtmlText(input = "", { url = "", maxChars = 120000 } = {}) {
  const html = String(input || "");
  if (!html) return "";
  const cleaned =
    extractReadableTextFromHtml(html, String(url || "")) ||
    extractVisibleTextFromHtml(html);
  return postCleanText(cleaned, maxChars);
}

export function cleanTextUniversal(
  input = "",
  { format = "auto", contentType = "", url = "", maxChars = 120000 } = {},
) {
  const text = String(input || "");
  const normalizedFormat = String(format || "auto").toLowerCase();
  const normalizedContentType = String(contentType || "").toLowerCase();
  const autoFormat =
    normalizedFormat !== "auto"
      ? normalizedFormat
      : normalizedContentType.includes("text/html") ||
          /<\s*html[\s>]|<\s*body[\s>]|<\s*div[\s>]|<\s*p[\s>]/i.test(text)
        ? "html"
        : normalizedContentType.includes("markdown") || /^#{1,6}\s/m.test(text)
          ? "markdown"
          : "text";

  if (autoFormat === "html") return cleanHtmlText(text, { url, maxChars });
  if (autoFormat === "markdown") return cleanMarkdownText(text, maxChars);
  return cleanPlainText(text, maxChars);
}
