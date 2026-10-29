/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { isPlainObject } from "@noobot/shared/value";

const BOOLEAN_LITERALS = Object.freeze({ true: true, false: false });
const INTEGER_LITERAL_RE = /^-?\d+$/;

function convertLiteral(expected, value) {
  if (typeof value !== "string") return { ok: false };
  if (expected === "boolean" && Object.hasOwn(BOOLEAN_LITERALS, value)) {
    return { ok: true, value: BOOLEAN_LITERALS[value] };
  }
  if (expected === "number" && INTEGER_LITERAL_RE.test(value)) {
    const parsed = Number(value);
    if (Number.isSafeInteger(parsed)) return { ok: true, value: parsed };
  }
  return { ok: false };
}

function readPath(root, path) {
  let node = root;
  for (const key of path) {
    if (node === null || typeof node !== "object") return undefined;
    node = node[key];
  }
  return node;
}

function writePath(root, path, value) {
  const parent = readPath(root, path.slice(0, -1));
  parent[path[path.length - 1]] = value;
}

export function repairToolCallArgs(schema, args) {
  if (typeof schema?.safeParse !== "function" || !isPlainObject(args)) return null;
  const firstPass = schema.safeParse(args);
  if (firstPass.success) return null;
  const repairedArgs = structuredClone(args);
  const repairs = [];
  for (const issue of firstPass.error.issues) {
    if (issue.code !== "invalid_type" || !issue.path?.length) continue;
    const from = readPath(repairedArgs, issue.path);
    const converted = convertLiteral(issue.expected, from);
    if (!converted.ok) continue;
    writePath(repairedArgs, issue.path, converted.value);
    repairs.push({ path: [...issue.path], from, to: converted.value });
  }
  if (!repairs.length || !schema.safeParse(repairedArgs).success) return null;
  return { args: repairedArgs, repairs };
}
