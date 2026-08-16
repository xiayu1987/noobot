/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { filePath, normalizeSlashPath } from "./platform.mjs";

export const TASK_PATH_KINDS = Object.freeze({
  INPUT: "input",
  OUTPUT: "output",
  TEMP: "temp",
});
export const TASK_PATH_VIEW = "task-local";

const TASK_PATH_KIND_SET = new Set(Object.values(TASK_PATH_KINDS));

function normalizeTaskPathKind(kind = "") {
  const normalized = String(kind || "").trim().toLowerCase();
  if (!TASK_PATH_KIND_SET.has(normalized)) throw new TypeError("task path kind must be input, output, or temp");
  return normalized;
}

export function normalizeTaskPathRelative(
  relative = "",
  { allowRoot = false, label = "task path" } = {},
) {
  const source = normalizeSlashPath(relative);
  const segments = source.split("/");
  const isAbsolute = source.startsWith("/") || /^[a-z]:\//i.test(source);
  const hasParentTraversal = segments.includes("..");
  const normalized = segments.filter((segment) => segment && segment !== ".").join("/");
  if (isAbsolute || hasParentTraversal || (!normalized && !allowRoot)) {
    throw new Error(`${String(label || "task path").trim()} must be a safe relative path without parent traversal`);
  }
  return normalized;
}

export function createTaskPath({ kind = "", relative = "", allowRoot = false } = {}) {
  const normalizedKind = normalizeTaskPathKind(kind);
  const normalizedRelative = normalizeTaskPathRelative(relative, { allowRoot });
  return `${normalizedKind}://${normalizedRelative}`;
}

export function parseTaskPath(value = "", { kind = "", allowRoot = false } = {}) {
  const text = String(value || "").trim();
  const match = /^([a-z]+):\/\/(.*)$/.exec(text);
  if (!match) throw new Error("task path token is required");
  const normalizedKind = normalizeTaskPathKind(match[1]);
  if (kind && normalizedKind !== normalizeTaskPathKind(kind)) throw new Error(`${kind} task path token is required`);
  const relative = normalizeTaskPathRelative(match[2], { allowRoot });
  return Object.freeze({ token: `${normalizedKind}://${relative}`, kind: normalizedKind, relative });
}

export function isTaskPath(value = "", { kind = "", allowRoot = true } = {}) {
  try {
    parseTaskPath(value, { kind, allowRoot });
    return true;
  } catch {
    return false;
  }
}

export function resolveTaskPath({ token = "", roots = {}, kind = "", allowRoot = false } = {}) {
  const parsed = parseTaskPath(token, { kind, allowRoot });
  const root = String(roots?.[parsed.kind] || "").trim();
  if (!root) throw new Error(`${parsed.kind} task path root is required`);
  const resolvedRoot = filePath.resolve(root);
  const resolvedPath = parsed.relative ? filePath.resolve(resolvedRoot, parsed.relative) : resolvedRoot;
  const relative = filePath.relative(resolvedRoot, resolvedPath);
  if (relative === ".." || relative.startsWith(`..${filePath.sep}`) || filePath.isAbsolute(relative)) {
    throw new Error("task path is outside its root");
  }
  return Object.freeze({ ...parsed, root: resolvedRoot, path: resolvedPath });
}

export function projectTaskPathText(value = "", mappings = []) {
  let text = String(value ?? "");
  const normalizedMappings = (Array.isArray(mappings) ? mappings : [])
    .map((item = {}) => {
      const hostRoot = String(item.hostRoot || "").replace(/[\\/]+$/, "");
      const parsedTaskRoot = parseTaskPath(item.taskRoot, { allowRoot: true });
      if (parsedTaskRoot.relative) throw new Error("task projection target must be a task root");
      return { hostRoot, taskRoot: parsedTaskRoot.token };
    })
    .filter((item) => item.hostRoot && item.taskRoot)
    .sort((a, b) => b.hostRoot.length - a.hostRoot.length);
  for (const { hostRoot, taskRoot } of normalizedMappings) {
    const escapedHostRoot = hostRoot.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    text = text
      .replace(new RegExp(`${escapedHostRoot}[\\\\/]`, "g"), taskRoot)
      .replace(new RegExp(`${escapedHostRoot}(?=$|[\\s\"'\x60\\]\\[),;])`, "g"), taskRoot);
  }
  return text;
}
