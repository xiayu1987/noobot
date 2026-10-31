/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { WORKSPACE_LAYOUT, WORKSPACE_LAYOUT_UPGRADE_OWNER } from "@noobot/workspace-protocol";
import {
  decodeToolResultText,
  encodeToolResultObject,
  TOOL_RESULT_ERROR,
} from "@noobot/event-protocol/tool-result";
import { TOOL_RESULT_MESSAGE_TYPE } from "@noobot/session-protocol";
import { isPlainObject } from "@noobot/shared/value";
import { TOOL_NAME } from "../tools/constants/index.js";
import { ignoreSessionProgress } from "./session-directory-walk.js";
import { createSessionMessageRewriter } from "./session-message-rewrite.js";
import { upgradeSessionDirectories } from "./session-upgrade-driver.js";

const KIND = WORKSPACE_LAYOUT_UPGRADE_OWNER.SESSION_LEGACY_MCP_RESULT;
const INVALID_CODE = "WORKSPACE_SESSION_LEGACY_MCP_RESULT_UPGRADE_INVALID";
const LEGACY_PASSTHROUGH_ERRORS = new Set([
  TOOL_RESULT_ERROR.NOT_JSON,
  TOOL_RESULT_ERROR.OK_NOT_BOOLEAN,
]);

function upgradeError(reason, details, cause) {
  const error = new Error(`workspace session legacy mcp result upgrade failed: ${reason}`);
  error.code = INVALID_CODE;
  error.details = { reason, ...details };
  if (cause) error.cause = cause;
  return error;
}

function isMcpTaskTurn(manifest, turnScopeId) {
  return manifest.turnLifecycle?.turns?.[turnScopeId]?.stage === TOOL_NAME.CALL_MCP_TASK;
}

function migrateResultText(resultText, { manifest, turnScopeId, details }) {
  try {
    decodeToolResultText(resultText);
    return null;
  } catch (cause) {
    if (!LEGACY_PASSTHROUGH_ERRORS.has(cause.code)) {
      throw upgradeError("tool_result_rejected", details, cause);
    }
    if (!isMcpTaskTurn(manifest, turnScopeId)) {
      throw upgradeError("legacy_result_source_unproven", details, cause);
    }
  }
  return encodeToolResultObject({ ok: true, content: [{ type: "text", text: resultText }] });
}

function migrateMessage(message, context) {
  const scope = {
    manifest: context.manifest,
    turnScopeId: message.turnScopeId,
    details: { ...context.details, messageUid: message.messageUid },
  };
  let next = message;
  if (message.type === TOOL_RESULT_MESSAGE_TYPE) {
    const content = migrateResultText(message.content, scope);
    if (content !== null) next = { ...next, content };
  }
  if (message.toolTimeline === undefined) return next;
  if (!Array.isArray(message.toolTimeline)) {
    throw upgradeError("tool_timeline_not_array", scope.details);
  }
  let changed = false;
  const toolTimeline = message.toolTimeline.map((item) => {
    if (!isPlainObject(item)) throw upgradeError("tool_timeline_item_invalid", scope.details);
    if (item.result === undefined) return item;
    const result = migrateResultText(item.result, {
      ...scope,
      details: { ...scope.details, toolCallId: item.toolCallId },
    });
    if (result === null) return item;
    changed = true;
    return { ...item, result };
  });
  return changed ? { ...next, toolTimeline } : next;
}

function migrateOutboxToolResult(payload, { manifest, identity, details }) {
  return migrateResultText(payload.result, {
    manifest,
    turnScopeId: identity.turnScopeId,
    details,
  });
}

const rewriter = createSessionMessageRewriter({
  upgradeError,
  migrateMessage,
  migrateOutboxToolResult,
});

export async function upgradeSessionLegacyMcpResults({
  base,
  backupBase,
  scopedSessionRoots,
  onSessionProcessed = ignoreSessionProgress,
}) {
  if (!Array.isArray(scopedSessionRoots) || !scopedSessionRoots.length) {
    throw new TypeError("session legacy mcp result upgrade requires scopedSessionRoots");
  }
  return upgradeSessionDirectories({
    base,
    roots: [WORKSPACE_LAYOUT.SESSION_DIR, ...scopedSessionRoots],
    kind: KIND,
    upgrade: ({ sessionDir }) => rewriter.upgradeSessionDirectory({ base, backupBase, sessionDir }),
    quarantineCode: INVALID_CODE,
    normalizeError: (error) => error,
    onSessionProcessed,
  });
}
