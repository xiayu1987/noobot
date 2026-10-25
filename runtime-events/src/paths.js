/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import path from "node:path";
import { WORKSPACE_LAYOUT } from "@noobot/workspace-protocol";
import { RUNTIME_EVENT_SCOPES } from "./constants.js";
import { resolveDefaultRuntimeEventsConfig } from "./config.js";
import { safeSegment } from "./sanitize.js";

const DEBUG_CATEGORY = "debug";

export function resolveRuntimeEventsConfig({ desktopRoot = "", env = process.env } = {}) {
  const resolvedDesktopRoot = desktopRoot ? path.resolve(String(desktopRoot)) : "";
  return {
    desktopRoot: resolvedDesktopRoot,
    ...resolveDefaultRuntimeEventsConfig(env, {
      requireWorkspaceRoot: !resolvedDesktopRoot,
    }),
  };
}

function resolveRuntimeEventDir(record, config, sessionDir) {
  if (config.desktopRoot) {
    return path.join(config.desktopRoot, safeSegment(record.scope), safeSegment(record.source));
  }
  if (record.scope === RUNTIME_EVENT_SCOPES.SESSION) {
    if (!sessionDir) throw new TypeError("session runtime events require a resolved sessionDir");
    return path.join(sessionDir, config.dirName);
  }
  const userPart = record.userId ? safeSegment(record.userId) : "system";
  return path.join(
    config.workspaceRoot,
    userPart,
    WORKSPACE_LAYOUT.RUNTIME_DIR,
    config.dirName,
    safeSegment(record.scope),
    safeSegment(record.source),
  );
}

export function resolveRuntimeEventFile(record, config, { sessionDir = "" } = {}) {
  return path.join(
    resolveRuntimeEventDir(record, config, sessionDir),
    `${resolveRuntimeEventFileCategory(record)}.jsonl`,
  );
}

function resolveRuntimeEventFileCategory(record = {}) {
  const category = safeSegment(record.category);
  if (record.scope !== RUNTIME_EVENT_SCOPES.SESSION || category !== DEBUG_CATEGORY) return category;

  return `${DEBUG_CATEGORY}-${safeSegment(record.debugType)}`;
}
