/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import fs from "node:fs/promises";
import path from "node:path";
import { WORKFLOW_DATA_SCOPE, resolveWorkflowDataRelativePath } from "../core/constants.js";
import { text } from "@noobot/shared/value";

function normalizeSessionIds(input = []) {
  if (Array.isArray(input)) {
    return input.map((item) => text(item)).filter(Boolean);
  }
  const sessionId = text(input);
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

function addSessionId(sessionIds, value = "") {
  const sessionId = text(value);
  if (sessionId && !hasPathSeparator(sessionId)) sessionIds.add(sessionId);
}

async function readJson(filePath = "") {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch {
    return null;
  }
}

async function collectWorkflowNodeSessionIds(workflowRoot = "", rootSessionId = "") {
  const relatedSessionIds = new Set();
  const workflowSessionDir = path.resolve(workflowRoot, WORKFLOW_DATA_SCOPE.SESSION, rootSessionId);
  if (!isSafePathInside(workflowRoot, workflowSessionDir)) return [];
  let entries = [];
  try {
    entries = await fs.readdir(workflowSessionDir, { withFileTypes: true });
  } catch {
    return [];
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const nodeDir = path.resolve(workflowSessionDir, entry.name);
    if (!isSafePathInside(workflowSessionDir, nodeDir)) continue;
    const metadata = await readJson(path.join(nodeDir, "meta.json"));
    addSessionId(relatedSessionIds, metadata?.sessionId);
  }
  return [...relatedSessionIds];
}

export async function collectWorkflowRelatedSessionIds(basePath = "", rootSessionIds = []) {
  const rootBasePath = text(basePath);
  const normalizedRootSessionIds = normalizeSessionIds(rootSessionIds);
  if (!rootBasePath || !normalizedRootSessionIds.length) return [];
  const workflowRoot = path.resolve(rootBasePath, resolveWorkflowDataRelativePath());
  const relatedSessionIds = new Set();
  for (const rootSessionId of normalizedRootSessionIds) {
    if (!rootSessionId || hasPathSeparator(rootSessionId)) continue;
    for (const sessionId of await collectWorkflowNodeSessionIds(workflowRoot, rootSessionId)) {
      relatedSessionIds.add(sessionId);
    }
  }
  return [...relatedSessionIds];
}

export async function cleanupWorkflowBySessionIds(basePath = "", sessionIds = []) {
  const rootBasePath = text(basePath);
  if (!rootBasePath) {
    return { deleted: 0, errors: 0, matchedDirs: 0, relatedSessionIds: [] };
  }
  const normalizedSessionIds = normalizeSessionIds(sessionIds);
  if (!normalizedSessionIds.length) {
    return { deleted: 0, errors: 0, matchedDirs: 0, relatedSessionIds: [] };
  }

  const workflowRoot = path.resolve(rootBasePath, resolveWorkflowDataRelativePath());
  let deleted = 0;
  let errors = 0;
  let matchedDirs = 0;
  const relatedSessionIds = new Set();

  for (const sessionId of normalizedSessionIds) {
    if (!sessionId || hasPathSeparator(sessionId)) continue;
    for (const relatedSessionId of await collectWorkflowRelatedSessionIds(rootBasePath, [
      sessionId,
    ])) {
      relatedSessionIds.add(relatedSessionId);
    }
    const targetPath = path.resolve(workflowRoot, WORKFLOW_DATA_SCOPE.SESSION, sessionId);
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

  return { deleted, errors, matchedDirs, relatedSessionIds: [...relatedSessionIds] };
}
