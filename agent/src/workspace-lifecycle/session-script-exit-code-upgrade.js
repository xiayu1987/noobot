/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { WORKSPACE_LAYOUT, WORKSPACE_LAYOUT_UPGRADE_OWNER } from "@noobot/workspace-protocol";
import { SCRIPT_FAILURE_CODE } from "@noobot/execution-isolation-protocol/script-outcome";
import { encodeToolResultObject } from "@noobot/event-protocol/tool-result";
import { TOOL_RESULT_MESSAGE_TYPE } from "@noobot/session-protocol";
import { isPlainObject } from "@noobot/shared/value";
import { TOOL_NAME } from "../tools/constants/index.js";
import { ignoreSessionProgress } from "./session-directory-walk.js";
import { createSessionMessageRewriter } from "./session-message-rewrite.js";
import { upgradeSessionDirectories } from "./session-upgrade-driver.js";

const KIND = WORKSPACE_LAYOUT_UPGRADE_OWNER.SESSION_SCRIPT_EXIT_CODE;
const INVALID_CODE = "WORKSPACE_SESSION_SCRIPT_EXIT_CODE_UPGRADE_INVALID";
const SCRIPT_TOOLS = new Set([TOOL_NAME.EXECUTE_SCRIPT, TOOL_NAME.EXECUTE_NATIVE_SCRIPT]);

function upgradeError(reason, details, cause) {
  const error = new Error(`workspace session script exit code upgrade failed: ${reason}`);
  error.code = INVALID_CODE;
  error.details = { reason, ...details };
  if (cause) error.cause = cause;
  return error;
}

function migrateResultText(text, details) {
  let result;
  try {
    result = JSON.parse(text);
  } catch (cause) {
    throw upgradeError("script_result_not_json", details, cause);
  }
  if (!isPlainObject(result)) throw upgradeError("script_result_not_object", details);
  if (typeof result.code !== "number") return null;
  if (!Number.isInteger(result.code) || typeof result.ok !== "boolean") {
    throw upgradeError("legacy_script_result_invalid", details);
  }
  if (Object.hasOwn(result, "exitCode") || Object.hasOwn(result, "termination")) {
    throw upgradeError("legacy_script_result_conflicting_facts", details);
  }
  const { code: exitCode, ...rest } = result;
  const migrated = {
    ...rest,
    exitCode,
    ...(result.ok ? {} : { code: SCRIPT_FAILURE_CODE.LEGACY_TERMINATION_UNKNOWN }),
  };
  try {
    return encodeToolResultObject(migrated);
  } catch (cause) {
    throw upgradeError("legacy_script_result_rejected", details, cause);
  }
}

function migrateMessage(message, context) {
  const details = { ...context.details, messageUid: message.messageUid };
  let next = message;
  if (message.type === TOOL_RESULT_MESSAGE_TYPE && SCRIPT_TOOLS.has(message.toolName)) {
    const content = migrateResultText(message.content, details);
    if (content !== null) next = { ...next, content };
  }
  if (message.toolTimeline !== undefined) {
    if (!Array.isArray(message.toolTimeline))
      throw upgradeError("tool_timeline_not_array", details);
    let changed = false;
    const toolTimeline = message.toolTimeline.map((item) => {
      if (!isPlainObject(item)) throw upgradeError("tool_timeline_item_invalid", details);
      if (!SCRIPT_TOOLS.has(item.tool) || item.result === undefined) return item;
      const result = migrateResultText(item.result, { ...details, toolCallId: item.toolCallId });
      if (result === null) return item;
      changed = true;
      return { ...item, result };
    });
    if (changed) next = { ...next, toolTimeline };
  }
  return next;
}

function migrateOutboxToolResult(payload, { details }) {
  if (!SCRIPT_TOOLS.has(payload.tool)) return null;
  return migrateResultText(payload.result, details);
}

const rewriter = createSessionMessageRewriter({
  upgradeError,
  migrateMessage,
  migrateOutboxToolResult,
});

export async function upgradeSessionScriptExitCodes({
  base,
  backupBase,
  scopedSessionRoots,
  onSessionProcessed = ignoreSessionProgress,
}) {
  if (!Array.isArray(scopedSessionRoots) || !scopedSessionRoots.length) {
    throw new TypeError("session script exit code upgrade requires scopedSessionRoots");
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
