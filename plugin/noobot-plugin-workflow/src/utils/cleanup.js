/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import fs from "node:fs/promises";
import path from "node:path";

function normalizeSessionIds(input = []) {
  if (Array.isArray(input)) {
    return input.map((item) => String(item || "").trim()).filter(Boolean);
  }
  const sessionId = String(input || "").trim();
  return sessionId ? [sessionId] : [];
}

function isSafePathInside(basePath = "", targetPath = "") {
  const baseResolved = path.resolve(basePath);
  const targetResolved = path.resolve(targetPath);
  const relative = path.relative(baseResolved, targetResolved);
  if (!relative) return true;
  if (relative.startsWith("..")) return false;
  if (path.isAbsolute(relative)) return false;
  return true;
}

function hasPathSeparator(value = "") {
  return String(value || "").includes("/") || String(value || "").includes("\\");
}

export async function cleanupWorkflowBySessionIds(basePath = "", sessionIds = []) {
  const rootBasePath = String(basePath || "").trim();
  if (!rootBasePath) {
    return { deleted: 0, errors: 0, matchedDirs: 0 };
  }
  const normalizedSessionIds = normalizeSessionIds(sessionIds);
  if (!normalizedSessionIds.length) {
    return { deleted: 0, errors: 0, matchedDirs: 0 };
  }

  const workflowRoot = path.resolve(rootBasePath, "runtime", "workflow");
  let deleted = 0;
  let errors = 0;
  let matchedDirs = 0;

  for (const sessionId of normalizedSessionIds) {
    if (!sessionId || hasPathSeparator(sessionId)) continue;
    const targets = [
      path.resolve(workflowRoot, "planning", sessionId),
      path.resolve(workflowRoot, "session", sessionId),
    ];

    for (const targetPath of targets) {
      if (!isSafePathInside(workflowRoot, targetPath)) continue;
      try {
        await fs.stat(targetPath);
      } catch {
        continue;
      }
      matchedDirs += 1;
      try {
        await fs.rm(targetPath, { recursive: true, force: true });
        deleted += 1;
      } catch {
        errors += 1;
      }
    }
  }

  return { deleted, errors, matchedDirs };
}
