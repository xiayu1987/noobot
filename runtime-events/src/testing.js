/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import fs from "node:fs/promises";
import path from "node:path";

import { WORKSPACE_LAYOUT } from "@noobot/workspace-protocol/layout";
import { readWorkspaceSessionTombstones, readWorkspaceSessionTree } from "./session-location.js";
import {
  createEmptySessionTree,
  createSessionTreeNode,
  resolveSessionDirSegments,
} from "@noobot/workspace-protocol/session-tree";
import { RUNTIME_EVENTS_CONFIG_ENVS } from "@noobot/shared/runtime-events-config";

const ENV_GROUPS = Object.freeze({
  log: RUNTIME_EVENTS_CONFIG_ENVS.sessionLogControls.log,
  debug: RUNTIME_EVENTS_CONFIG_ENVS.sessionLogControls.debug,
  storage: RUNTIME_EVENTS_CONFIG_ENVS.runtimeEvents,
  executionLog: RUNTIME_EVENTS_CONFIG_ENVS.executionLogControls,
});

export function resolveRuntimeEventsEnvAssignments({ workspaceRoot = "", ...groups } = {}) {
  const assignments = [];
  if (workspaceRoot) assignments.push(["NOOBOT_WORKSPACE_ROOT", String(workspaceRoot)]);
  for (const [group, values] of Object.entries(groups)) {
    const names = ENV_GROUPS[group];
    if (!names) throw new TypeError(`Unknown runtime events env group: ${group}`);
    for (const [key, value] of Object.entries(values || {})) {
      const name = names[key];
      if (!name) throw new TypeError(`Unknown runtime events ${group} switch: ${key}`);
      assignments.push([name, String(value)]);
    }
  }
  return assignments;
}

export function applyRuntimeEventsEnv(declaration = {}) {
  const assignments = resolveRuntimeEventsEnvAssignments(declaration);
  const previous = assignments.map(([name]) => [name, process.env[name]]);
  for (const [name, value] of assignments) process.env[name] = value;
  return () => {
    for (const [name, value] of previous.reverse()) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  };
}

export function useRuntimeEventsEnv(t, declaration = {}) {
  t.after(applyRuntimeEventsEnv(declaration));
}

export async function withRuntimeEventsEnv(declaration, operation) {
  const restore = applyRuntimeEventsEnv(declaration);
  try {
    return await operation();
  } finally {
    restore();
  }
}

async function writeJson(file, value) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify(value), "utf8");
}

function userRootOf(workspaceRoot, userId) {
  return path.join(workspaceRoot, userId);
}

function sessionTreeFile(workspaceRoot, userId) {
  return path.join(userRootOf(workspaceRoot, userId), WORKSPACE_LAYOUT.SESSION_TREE_FILE);
}

export async function initializeSessionTree(workspaceRoot, userId) {
  await writeJson(sessionTreeFile(workspaceRoot, userId), createEmptySessionTree());
}

export async function sessionDirPath(workspaceRoot, userId, sessionId) {
  const tree = await readWorkspaceSessionTree(userRootOf(workspaceRoot, userId));
  return path.join(
    userRootOf(workspaceRoot, userId),
    ...resolveSessionDirSegments(tree, sessionId),
  );
}

export async function persistSession(
  workspaceRoot,
  userId,
  { sessionId, parentSessionId, caller },
) {
  const userRoot = userRootOf(workspaceRoot, userId);
  const tree = await readWorkspaceSessionTree(userRoot);
  const node = createSessionTreeNode({ sessionId, parentSessionId, caller });
  tree.nodes[node.sessionId] = node;
  await writeJson(sessionTreeFile(workspaceRoot, userId), tree);
  const sessionDir = path.join(userRoot, ...resolveSessionDirSegments(tree, node.sessionId));
  await writeJson(path.join(sessionDir, "session.json"), node);
  return sessionDir;
}

export async function markSessionDeleted(workspaceRoot, userId, sessionId) {
  const userRoot = userRootOf(workspaceRoot, userId);
  const markerFile = path.join(userRoot, WORKSPACE_LAYOUT.SESSION_TOMBSTONE_FILE);
  const sessions = await readWorkspaceSessionTombstones(userRoot);
  await writeJson(markerFile, { sessions: { ...sessions, [sessionId]: Date.now() } });
  return { markerFile };
}
