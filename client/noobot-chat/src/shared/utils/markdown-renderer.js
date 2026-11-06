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
export function looksLikeMermaidLine(rawLine = "") {
  const line = rawLine.trim();
  return MERMAID_PREFIXES.some((prefix) => line.startsWith(prefix));
}
export function normalizeMermaidMarkdown(source = "") {
  let inCodeFence = false;
  return source
    .split(/\r?\n/u)
    .map((line) => {
      if (line.trim().startsWith("```")) {
        inCodeFence = !inCodeFence;
        return line;
      }
      return !inCodeFence && looksLikeMermaidLine(line) ? `\`\`\`mermaid\n${line}\n\`\`\`` : line;
    })
    .join("\n");
}
export function createMarkdownRenderer() {
  const md = new MarkdownIt({ html: false, linkify: true, breaks: true });
  const fence = md.renderer.rules.fence;
  md.renderer.rules.fence = (tokens, index, options, env, self) => {
    const token = tokens[index];
    return token.info.trim().toLowerCase() === "mermaid"
      ? `<div class="mermaid">${md.utils.escapeHtml(token.content)}</div>`
      : fence(tokens, index, options, env, self);
  };
  return md;
}
const fileMarkdown = createMarkdownRenderer();
export function renderFileMarkdown(content) {
  return fileMarkdown.render(normalizeMermaidMarkdown(content));
}
