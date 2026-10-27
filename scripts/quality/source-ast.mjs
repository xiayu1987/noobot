/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import * as espree from "espree";
import { parse as parseVue } from "vue-eslint-parser";

const SKIPPED_KEYS = new Set(["parent", "loc", "range", "tokens", "comments", "templateBody"]);
export const SKIP_SUBTREE = Symbol("skip-subtree");

export function walk(node, parent, visitor) {
  if (!node || typeof node.type !== "string") return;
  if (visitor(node, parent) === SKIP_SUBTREE) return;
  for (const [key, value] of Object.entries(node)) {
    if (SKIPPED_KEYS.has(key)) continue;
    if (Array.isArray(value)) value.forEach((child) => walk(child, node, visitor));
    else if (value && typeof value.type === "string") walk(value, node, visitor);
  }
}

export function snippet(source, node) {
  return { line: node.loc.start.line, code: source.slice(...node.range).replace(/\s+/g, " ") };
}

export function parseSource(source, filename) {
  const options = { ecmaVersion: "latest", sourceType: "module", loc: true, range: true };
  if (filename.endsWith(".vue")) return parseVue(source, options);
  return espree.parse(source, { ...options, ecmaFeatures: { jsx: filename.endsWith(".jsx") } });
}
