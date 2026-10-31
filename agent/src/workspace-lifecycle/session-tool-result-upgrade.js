/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { isAbsolutePathAnyPlatform, PATH_REF_VIEWS } from "@noobot/path-resolver";
import { WORKSPACE_LAYOUT, WORKSPACE_LAYOUT_UPGRADE_OWNER } from "@noobot/workspace-protocol";
import { FILE_MUTATION_PROTOCOL, FILE_MUTATION_VERSION } from "@noobot/file-mutation-protocol";
import { WORKSPACE_SANDBOX_PATHS } from "@noobot/execution-isolation-protocol";
import { createLocator } from "@noobot/shared/locator";
import {
  decodeToolResultText,
  encodeToolResultObject,
  TOOL_RESULT_ERROR,
} from "@noobot/event-protocol/tool-result-v24";
import { TOOL_RESULT_MESSAGE_TYPE } from "@noobot/session-protocol";
import { isPlainObject } from "@noobot/shared/value";
import { TOOL_NAME } from "../tools/constants/index.js";
import { ignoreSessionProgress } from "./session-directory-walk.js";
import { createSessionMessageRewriter } from "./session-message-rewrite.js";
import { upgradeSessionDirectories } from "./session-upgrade-driver.js";

const UPGRADE_INVALID_CODE = "WORKSPACE_SESSION_TOOL_RESULT_UPGRADE_INVALID";
const QUARANTINE_KIND = WORKSPACE_LAYOUT_UPGRADE_OWNER.SESSION_TOOL_RESULT;

const LEGACY_PATCH_RESULT_FIELDS = new Set([
  "toolName",
  "ok",
  "format",
  "strip",
  "dryRun",
  "root",
  "requestedRoot",
  "changedFiles",
  "deletedFiles",
  "resolvedFiles",
]);
const PATCH_ACTIONS = new Set(["write", "delete"]);
const LEGACY_PATCH_CHANGE_FIELDS = new Set(["path", "resolvedPath", "action"]);

function upgradeError(reason, details, cause) {
  const error = new Error(`workspace session tool result upgrade failed: ${reason}`);
  error.code = UPGRADE_INVALID_CODE;
  error.details = { reason, ...details };
  if (cause) error.cause = cause;
  return error;
}

function legacyPathRef(logicalPath, details) {
  if (typeof logicalPath !== "string" || !logicalPath) {
    throw upgradeError("legacy_patch_path_missing", details);
  }
  return {
    view: isAbsolutePathAnyPlatform(logicalPath) ? PATH_REF_VIEWS.HOST : PATH_REF_VIEWS.WORKSPACE,
    path: logicalPath,
  };
}

function legacyChange(item, details) {
  if (
    !isPlainObject(item) ||
    !Object.keys(item).every((field) => LEGACY_PATCH_CHANGE_FIELDS.has(field)) ||
    !PATCH_ACTIONS.has(item.action)
  ) {
    throw upgradeError("legacy_patch_change_invalid", details);
  }
  return { path: legacyPathRef(item.path, details), action: item.action };
}

function migratePatchResult(result, details) {
  if (result.ok === false || result.overflowed === true) return null;
  if (Array.isArray(result.changes)) return null;
  if (!Object.keys(result).every((field) => LEGACY_PATCH_RESULT_FIELDS.has(field))) {
    throw upgradeError("legacy_patch_result_unrecognized", details);
  }
  if (result.ok !== true || result.dryRun !== true) {
    throw upgradeError("legacy_patch_result_not_dry_run", details);
  }
  if (!Array.isArray(result.resolvedFiles) || !result.resolvedFiles.length) {
    throw upgradeError("legacy_patch_resolved_files_missing", details);
  }
  return {
    toolName: TOOL_NAME.PATCH_FILE,
    ok: true,
    protocol: FILE_MUTATION_PROTOCOL,
    version: FILE_MUTATION_VERSION,
    format: result.format,
    ...(result.strip === undefined ? {} : { strip: result.strip }),
    dryRun: true,
    root: legacyPathRef(result.root, details),
    changes: result.resolvedFiles.map((item) => legacyChange(item, details)),
    mutations: [],
    outputResources: [],
  };
}

function migrateResultText(resultText, details) {
  let result;
  try {
    result = decodeToolResultText(resultText);
  } catch (cause) {
    throw upgradeError("tool_result_rejected", details, cause);
  }
  const migrated = migratePatchResult(result, details);
  return migrated ? encodeToolResultObject(migrated) : null;
}

function migrateReadResultText(resultText, details) {
  const result = decodeToolResultText(resultText);
  if (!result.ok || result.overflowed === true || isPlainObject(result.path)) return null;
  if (result.isSandbox === true && result.path === undefined) {
    const mount = WORKSPACE_SANDBOX_PATHS.ROOT;
    if (typeof result.resolvedPath !== "string" || !result.resolvedPath.startsWith(`${mount}/`)) {
      throw upgradeError("legacy_read_execution_view_unproven", details);
    }
    const { resolvedPath, isSandbox: _isSandbox, ...rest } = result;
    const path = createLocator({
      view: PATH_REF_VIEWS.MOUNT,
      mount,
      path: resolvedPath.slice(mount.length + 1),
    });
    return encodeToolResultObject({ ...rest, path });
  }
  if (result.isSandbox !== false) {
    throw upgradeError("legacy_read_execution_view_unproven", details);
  }
  const { resolvedPath, isSandbox: _isSandbox, ...rest } = result;
  if (result.path !== undefined) {
    if (resolvedPath !== undefined) throw upgradeError("legacy_read_path_ambiguous", details);
    return encodeToolResultObject({ ...rest, path: legacyPathRef(result.path, details) });
  }
  if (!isAbsolutePathAnyPlatform(resolvedPath)) {
    throw upgradeError("legacy_read_resolved_path_invalid", details);
  }
  return encodeToolResultObject({ ...rest, path: legacyPathRef(resolvedPath, details) });
}

async function toolResultContents(context) {
  context.shared.toolResultContents ??= (async () => {
    const index = new Map();
    for (const message of await context.loadSessionMessages()) {
      if (message.type !== TOOL_RESULT_MESSAGE_TYPE) continue;
      const contents = index.get(message.tool_call_id) ?? new Set();
      contents.add(message.content);
      index.set(message.tool_call_id, contents);
    }
    return index;
  })();
  return context.shared.toolResultContents;
}

function isTruncatedResultText(resultText) {
  try {
    decodeToolResultText(resultText);
    return false;
  } catch (error) {
    return error.code === TOOL_RESULT_ERROR.NOT_JSON;
  }
}

async function restoreTruncatedResult(item, context, details) {
  if (typeof item.result !== "string" || !isTruncatedResultText(item.result)) return item.result;
  const contents = (await toolResultContents(context)).get(item.toolCallId);
  if (!contents) throw upgradeError("truncated_timeline_result_unpaired", details);
  if (contents.size !== 1) throw upgradeError("truncated_timeline_result_ambiguous", details);
  const [content] = contents;
  if (content === item.result) return item.result;
  if (!content.startsWith(item.result)) {
    throw upgradeError("truncated_timeline_result_mismatch", details);
  }
  return content;
}

async function migrateToolTimeline(toolTimeline, context, details) {
  if (toolTimeline === undefined) return null;
  if (!Array.isArray(toolTimeline)) throw upgradeError("tool_timeline_not_array", details);
  let changed = false;
  const next = [];
  for (const item of toolTimeline) {
    if (!isPlainObject(item)) throw upgradeError("tool_timeline_item_invalid", details);
    const itemDetails = { ...details, toolCallId: item.toolCallId };
    const restored = await restoreTruncatedResult(item, context, itemDetails);
    let migrated = null;
    if (restored !== undefined && item.tool === TOOL_NAME.PATCH_FILE) {
      migrated = migrateResultText(restored, itemDetails);
    }
    if (restored !== undefined && item.tool === TOOL_NAME.READ_FILE) {
      migrated = migrateReadResultText(restored, itemDetails);
    }
    const result = migrated ?? restored;
    if (result === item.result) {
      next.push(item);
      continue;
    }
    changed = true;
    next.push({ ...item, result });
  }
  return changed ? next : null;
}

async function migrateMessage(message, context) {
  const details = { ...context.details, messageUid: message.messageUid };
  let next = message;
  if (message.type === TOOL_RESULT_MESSAGE_TYPE && message.toolName === TOOL_NAME.PATCH_FILE) {
    const content = migrateResultText(message.content, details);
    if (content !== null) next = { ...next, content };
  }
  if (message.type === TOOL_RESULT_MESSAGE_TYPE && message.toolName === TOOL_NAME.READ_FILE) {
    const content = migrateReadResultText(message.content, details);
    if (content !== null) next = { ...next, content };
  }
  const toolTimeline = await migrateToolTimeline(message.toolTimeline, context, details);
  if (toolTimeline !== null) next = { ...next, toolTimeline };
  return next;
}

const rewriter = createSessionMessageRewriter({ upgradeError, migrateMessage });

export async function upgradeSessionToolResults({
  base,
  backupBase,
  scopedSessionRoots,
  onSessionProcessed = ignoreSessionProgress,
}) {
  if (!Array.isArray(scopedSessionRoots) || !scopedSessionRoots.length) {
    throw new TypeError("session tool result upgrade requires scopedSessionRoots");
  }
  return upgradeSessionDirectories({
    base,
    roots: [WORKSPACE_LAYOUT.SESSION_DIR, ...scopedSessionRoots],
    kind: QUARANTINE_KIND,
    upgrade: ({ sessionDir }) => rewriter.upgradeSessionDirectory({ base, backupBase, sessionDir }),
    quarantineCode: UPGRADE_INVALID_CODE,
    normalizeError: (error) => error,
    onSessionProcessed,
  });
}
