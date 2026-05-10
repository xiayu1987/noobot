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

// Module-level singleton to avoid re-creating MarkdownIt per component instance
const md = new MarkdownIt({ html: true, linkify: true, breaks: true });
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

export function useMarkdownRenderer() {
  function renderMarkdown(text) {
    return md.render(normalizeMermaidMarkdown(text || ""));
  }

  return {
    renderMarkdown,
    normalizeMermaidMarkdown,
    looksLikeMermaidLine,
  };
}
