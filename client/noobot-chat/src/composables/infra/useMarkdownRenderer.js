/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import MarkdownIt from "markdown-it";
import { provideExtensionValues } from "../../extensions/extension-registry.js";
import { EXTENSION_POINTS } from "../../extensions/extension-point-ids.js";

const MERMAID_PREFIXES = [
  "graph ",
  "flowchart ",
  "sequenceDiagram",
  "classDiagram",
  "stateDiagram",
  "erDiagram",
  "journey",
  "gantt",
  "pie ",
  "mindmap",
  "timeline",
];
function collapseMarkerNames() {
  return ["NOOBOT_COLLAPSE", ...provideExtensionValues(EXTENSION_POINTS.MARKDOWN_COLLAPSE_MARKERS)]
    .map((value) => String(value || "").trim()).filter(Boolean);
}

function looksLikeMermaidLine(rawLine = "") {
  const line = String(rawLine || "").trim();
  if (!line) return false;
  return MERMAID_PREFIXES.some((prefix) => line.startsWith(prefix));
}

function normalizeMermaidMarkdown(inputText = "") {
  const sourceText = String(inputText || "");
  if (!sourceText.trim()) return sourceText;
  const lines = sourceText.split(/\r?\n/);
  const outputLines = [];
  let inCodeFence = false;

  for (const currentLine of lines) {
    const trimmedLine = String(currentLine || "").trim();
    if (trimmedLine.startsWith("```")) {
      inCodeFence = !inCodeFence;
      outputLines.push(currentLine);
      continue;
    }
    if (!inCodeFence && looksLikeMermaidLine(currentLine)) {
      outputLines.push("```mermaid");
      outputLines.push(currentLine);
      outputLines.push("```");
      continue;
    }
    outputLines.push(currentLine);
  }
  return outputLines.join("\n");
}

const md = new MarkdownIt({ html: false, linkify: true, breaks: true });
const defaultFenceRenderer =
  md.renderer.rules.fence ||
  ((tokens, idx, options, env, self) =>
    self.renderToken(tokens, idx, options));
md.renderer.rules.fence = (tokens, idx, options, env, self) => {
  const token = tokens[idx] || {};
  const info = String(token?.info || "").trim().toLowerCase();
  if (info === "mermaid") {
    const diagramCode = md.utils.escapeHtml(String(token?.content || ""));
    return `<div class="mermaid">${diagramCode}</div>`;
  }
  return defaultFenceRenderer(tokens, idx, options, env, self);
};

function escapeHtmlAttribute(value = "") {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function normalizeCssModifier(value = "") {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "") || "unknown";
}

function parseMarkerAttributes(input = "") {
  const attrs = {};
  const text = String(input || "");
  const attrRe = /([A-Za-z0-9_-]+)="([^"]*)"/g;
  let match = attrRe.exec(text);
  while (match) {
    attrs[match[1]] = match[2]
      .replace(/&quot;/g, "\"")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&amp;/g, "&");
    match = attrRe.exec(text);
  }
  return attrs;
}

function renderMarkdownSegment(text = "") {
  const content = String(text || "");
  if (!content.trim()) return "";
  return md.render(normalizeMermaidMarkdown(content));
}

function buildCollapseHtml({ attrs = {}, innerMarkdown = "" } = {}) {
  const kind = String(attrs.kind || "unknown").trim() || "unknown";
  const kindClass = normalizeCssModifier(kind);
  const title = String(attrs.title || kind).trim() || kind;
  const defaultState = String(attrs.default || "closed").trim().toLowerCase();
  const openAttr = defaultState === "open" ? " open" : "";
  const renderedInner = renderMarkdownSegment(innerMarkdown);
  return [
    `<details class="noobot-collapse noobot-collapse--${escapeHtmlAttribute(kindClass)}" data-noobot-collapse="${escapeHtmlAttribute(kind)}"${openAttr}>`,
    `<summary>${escapeHtmlAttribute(title)}</summary>`,
    `<div class="noobot-collapse__body">${renderedInner}</div>`,
    "</details>",
  ].join("\n");
}

function shouldHideCollapse({ attrs = {} } = {}) {
  const kind = String(attrs.kind || "").trim();
  return kind === "latest_complete_summary" || kind === "acceptance";
}

function renderCollapsibleMarkdown(text = "") {
  const source = String(text || "");
  const markerNames = collapseMarkerNames();
  if (!markerNames.some((markerName) => source.includes(`<<<${markerName}:start`))) {
    return renderMarkdownSegment(source);
  }
  const markerPattern = markerNames.join("|");
  const collapseStartRe = new RegExp(`^\\s*<<<(?:${markerPattern}):start\\s+([\\s\\S]*?)>>>\\s*$`);
  const collapseEndRe = new RegExp(`^\\s*<<<(?:${markerPattern}):end(?:\\s+([\\s\\S]*?))?>>>\\s*$`);
  const lines = source.split(/\r?\n/);
  const renderedParts = [];
  let plainBuffer = [];

  const flushPlain = () => {
    if (!plainBuffer.length) return;
    renderedParts.push(renderMarkdownSegment(plainBuffer.join("\n")));
    plainBuffer = [];
  };

  for (let index = 0; index < lines.length; index += 1) {
    const currentLine = lines[index] || "";
    const startMatch = currentLine.match(collapseStartRe);
    if (!startMatch) {
      plainBuffer.push(currentLine);
      continue;
    }

    const attrs = parseMarkerAttributes(startMatch[1] || "");
    const expectedKind = String(attrs.kind || "").trim();
    const innerLines = [];
    let endIndex = -1;
    for (let cursor = index + 1; cursor < lines.length; cursor += 1) {
      const endMatch = String(lines[cursor] || "").match(collapseEndRe);
      if (!endMatch) {
        innerLines.push(lines[cursor]);
        continue;
      }
      const endAttrs = parseMarkerAttributes(endMatch[1] || "");
      const endKind = String(endAttrs.kind || "").trim();
      if (expectedKind && endKind && endKind !== expectedKind) {
        innerLines.push(lines[cursor]);
        continue;
      }
      endIndex = cursor;
      break;
    }

    if (endIndex < 0) {
      plainBuffer.push(currentLine);
      continue;
    }

    flushPlain();
    if (!shouldHideCollapse({ attrs })) {
      renderedParts.push(buildCollapseHtml({
        attrs,
        innerMarkdown: innerLines.join("\n"),
      }));
    }
    index = endIndex;
  }

  flushPlain();
  return renderedParts.join("\n");
}

export function useMarkdownRenderer() {
  function renderMarkdown(text) {
    return renderCollapsibleMarkdown(text || "");
  }

  return {
    renderMarkdown,
    normalizeMermaidMarkdown,
    looksLikeMermaidLine,
    renderCollapsibleMarkdown,
  };
}
