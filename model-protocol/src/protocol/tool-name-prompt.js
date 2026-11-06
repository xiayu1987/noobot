/* Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
export const TOOL_NAME_REFERENCE_BLOCK = "tool_name_reference";

export function compileToolNamePrompt(template) {
  if (typeof template !== "string") throw new TypeError("tool name prompt must be a string");
  const blocks = [];
  let cursor = 0;
  for (const match of template.matchAll(/\{\{tool:([^{}]+)\}\}/g)) {
    if (match.index > cursor)
      blocks.push({ type: "text", text: template.slice(cursor, match.index) });
    blocks.push({ type: TOOL_NAME_REFERENCE_BLOCK, toolId: match[1] });
    cursor = match.index + match[0].length;
  }
  if (cursor < template.length) blocks.push({ type: "text", text: template.slice(cursor) });
  return blocks;
}

export function projectToolNamePrompt(content, binding) {
  if (!Array.isArray(content)) return content;
  if (!content.some((block) => block.type === TOOL_NAME_REFERENCE_BLOCK)) return content;
  const projected = [];
  for (const block of content) {
    const next =
      block.type === TOOL_NAME_REFERENCE_BLOCK
        ? { type: "text", text: binding.referenceName(block.toolId) }
        : block;
    const previous = projected.at(-1);
    if (next.type === "text" && previous?.type === "text") previous.text += next.text;
    else projected.push(next.type === "text" ? { ...next } : next);
  }
  return projected;
}
