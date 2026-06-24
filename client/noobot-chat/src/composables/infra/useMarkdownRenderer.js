/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import MarkdownIt from "markdown-it";

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
const HARNESS_COLLAPSE_MARKER_NAME = "NOOBOT_HARNESS_COLLAPSE";
const HARNESS_COLLAPSE_START_RE = new RegExp(
  `^\\s*<<<${HARNESS_COLLAPSE_MARKER_NAME}:start\\s+([\\s\\S]*?)>>>\\s*$`,
);
const HARNESS_COLLAPSE_END_RE = new RegExp(
  `^\\s*<<<${HARNESS_COLLAPSE_MARKER_NAME}:end(?:\\s+([\\s\\S]*?))?>>>\\s*$`,
);

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

// Module-level singleton to avoid re-creating MarkdownIt per component instance.
// Keep raw HTML disabled so user input such as "<!-- test -->" is rendered as
// visible text instead of being injected into the DOM as hidden HTML comments.
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

function buildHarnessCollapseHtml({ attrs = {}, innerMarkdown = "" } = {}) {
  const kind = String(attrs.kind || "unknown").trim() || "unknown";
  const kindClass = normalizeCssModifier(kind);
  const title = String(attrs.title || kind).trim() || kind;
  const defaultState = String(attrs.default || "closed").trim().toLowerCase();
  const openAttr = defaultState === "open" ? " open" : "";
  const renderedInner = renderMarkdownSegment(innerMarkdown);
  return [
    `<details class="noobot-harness-collapse noobot-harness-collapse--${escapeHtmlAttribute(kindClass)}" data-noobot-harness-collapse="${escapeHtmlAttribute(kind)}"${openAttr}>`,
    `<summary>${escapeHtmlAttribute(title)}</summary>`,
    `<div class="noobot-harness-collapse__body">${renderedInner}</div>`,
    "</details>",
  ].join("\n");
}

function shouldHideHarnessCollapse({ attrs = {} } = {}) {
  const kind = String(attrs.kind || "").trim();
  return kind === "latest_complete_summary" || kind === "acceptance";
}

function renderHarnessCollapsibleMarkdown(text = "") {
  const source = String(text || "");
  if (!source.includes(`<<<${HARNESS_COLLAPSE_MARKER_NAME}:start`)) {
    return renderMarkdownSegment(source);
  }
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
    const startMatch = currentLine.match(HARNESS_COLLAPSE_START_RE);
    if (!startMatch) {
      plainBuffer.push(currentLine);
      continue;
    }

    const attrs = parseMarkerAttributes(startMatch[1] || "");
    const expectedKind = String(attrs.kind || "").trim();
    const innerLines = [];
    let endIndex = -1;
    for (let cursor = index + 1; cursor < lines.length; cursor += 1) {
      const endMatch = String(lines[cursor] || "").match(HARNESS_COLLAPSE_END_RE);
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
    if (!shouldHideHarnessCollapse({ attrs })) {
      renderedParts.push(buildHarnessCollapseHtml({
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
    return renderHarnessCollapsibleMarkdown(text || "");
  }

  return {
    renderMarkdown,
    normalizeMermaidMarkdown,
    looksLikeMermaidLine,
    renderHarnessCollapsibleMarkdown,
  };
}
