/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { SystemMessage } from "@langchain/core/messages";
import { buildCanonicalMessageBlocks } from "@noobot/context-protocol/block-strategy";
import { AGENT_MODEL_CONTEXT_POLICY_OPTIONS } from "../../session/message-context-policy.js";
import { MAIN_MODEL_HISTORY_ROUND_LIMIT } from "../../../session/utils/context-window-normalizer.js";
import { resolveDialogProcessId } from "../../session/dialog-process-id-resolver.js";
import { resolveParentSessionId } from "../../parent-session-id-resolver.js";
import { resolveRuntimeUserMessageAttachments } from "../../../artifacts/index.js";
import { buildHistoryMessages } from "./history.js";
import {
  canonicalMessageId,
  emitContextIdentityDebug,
} from "../../../observability/context-identity-debug.js";

export function buildContextMessageBlocks(
  agentContext,
  { currentUserMessage = null } = {},
) {
  const runtime = agentContext?.execution?.controllers?.runtime || {};
  const systemRuntime = runtime?.systemRuntime || {};
  const runtimeParentSessionId = resolveParentSessionId({ runtime });
  const currentUserMessageAttachments = resolveRuntimeUserMessageAttachments(runtime);
  const fallbackUserMeta = {
    userName: String(runtime?.userId || "").trim(),
    sessionId: String(systemRuntime?.sessionId || "").trim(),
    parentSessionId: runtimeParentSessionId,
    dialogProcessId: "",
    parentDialogProcessId: String(
      systemRuntime?.parentDialogProcessId || "",
    ).trim(),
    attachments: currentUserMessageAttachments,
    userMessageAttachments: currentUserMessageAttachments,
  };
  const systemMessages = Array.isArray(agentContext?.payload?.messages?.system)
    ? agentContext.payload.messages.system
    : [];
  const rawHistoryMessages = Array.isArray(agentContext?.payload?.messages?.history)
    ? agentContext.payload.messages.history
    : [];
  const restoredIncrementalMessages = Array.isArray(agentContext?.payload?.messages?.incremental)
    ? agentContext.payload.messages.incremental
    : [];
  const currentTurnScopeId = String(
    systemRuntime?.turnScopeId || systemRuntime?.config?.turnScopeId || "",
  ).trim();
  fallbackUserMeta.turnScopeId = currentTurnScopeId;
  const historyMessages = rawHistoryMessages;
  const resolvedDialogProcessId = resolveDialogProcessId({
    ctx: {
      agentContext: {
        execution: {
          dialogProcessId: systemRuntime?.dialogProcessId,
          controllers: { runtime: { systemRuntime } },
        },
      },
    },
    messages: historyMessages,
  });
  fallbackUserMeta.dialogProcessId = resolvedDialogProcessId;
  const identity = {
    userId: runtime?.userId || systemRuntime?.userId,
    sessionId: systemRuntime?.sessionId,
    parentSessionId: runtimeParentSessionId,
    dialogProcessId: resolvedDialogProcessId,
    turnScopeId: currentTurnScopeId,
  };
  const currentCanonicalId = canonicalMessageId(currentUserMessage);
  emitContextIdentityDebug(runtime?.eventListener, "contextBuildInput", identity, {
    messageUid: String(currentUserMessage?.messageUid || "").trim(),
    currentCanonicalId,
    systemCount: systemMessages.length,
    historyCount: rawHistoryMessages.length,
    restoredIncrementalCount: restoredIncrementalMessages.length,
    attachmentCount: Array.isArray(currentUserMessage?.attachments)
      ? currentUserMessage.attachments.length
      : 0,
  });
  const resolvedMainBlocks = buildCanonicalMessageBlocks({
    systemMessages,
    historyMessages,
    incrementalMessages: restoredIncrementalMessages,
    currentUserMessage,
    historyLimit: MAIN_MODEL_HISTORY_ROUND_LIMIT,
    policyOptions: AGENT_MODEL_CONTEXT_POLICY_OPTIONS,
  });
  emitContextIdentityDebug(runtime?.eventListener, "canonicalBlocksResolved", identity, {
    currentCanonicalId,
    currentMessagePresent: Boolean(currentCanonicalId),
    currentAlreadyInIncremental: restoredIncrementalMessages.some(
      (message) => canonicalMessageId(message) === currentCanonicalId,
    ),
    systemCount: resolvedMainBlocks.system.length,
    historyCount: resolvedMainBlocks.history.length,
    incrementalCount: resolvedMainBlocks.incremental.length,
  });

  const system = [];
  for (const content of resolvedMainBlocks.system) {
    system.push(
      new SystemMessage({
        content: typeof content === "string" ? content : String(content?.content || ""),
        additional_kwargs: {
          noobotInternalMessageType: "system_context",
        },
      }),
    );
  }
  const history = buildHistoryMessages({
    effectiveHistoryMessages: resolvedMainBlocks.history,
    runtime,
    fallbackUserMeta,
    includeUserMeta: false,
  });
  const incremental = buildHistoryMessages({
    effectiveHistoryMessages: resolvedMainBlocks.incremental,
    runtime,
    fallbackUserMeta,
    includeUserMeta: false,
    allowMessageAttachments: true,
  });
  const projectedIds = incremental.map(canonicalMessageId).filter(Boolean);
  emitContextIdentityDebug(runtime?.eventListener, "modelProjectionBuilt", identity, {
    sourceMessageUid: String(currentUserMessage?.messageUid || "").trim(),
    contentProjectionId: projectedIds.find((id) => id === currentCanonicalId) || "",
    userMetaProjectionId: projectedIds.find((id) => id === `${currentCanonicalId}::user_meta`) || "",
    incrementalCount: incremental.length,
    flatMessageCount: system.length + history.length + incremental.length,
  });
  return {
    system,
    history,
    incremental,
    messages: [...system, ...history, ...incremental],
    resolvedDialogProcessId,
  };
}

export function buildContextMessages(
  agentContext,
  { currentUserMessage = null } = {},
) {
  return buildContextMessageBlocks(agentContext, {
    currentUserMessage,
  }).messages;
}
