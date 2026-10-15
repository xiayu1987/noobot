/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { SystemMessage } from "@langchain/core/messages";
import { buildCanonicalMessageBlocks } from "@noobot/context-protocol/policy/block";
import { CONTEXT_INTERNAL_MESSAGE_TYPE } from "@noobot/context-protocol/message/internal-types";
import { TURN_THRESHOLDS } from "@noobot/shared/turn-thresholds";
import { resolveRuntimeUserMessageAttachments } from "../../../artifacts/index.js";
import {
  getAgentContextEnvelope,
  getRuntimeFromAgentContext,
} from "../../agent-context-accessor.js";
import { buildHistoryMessages } from "./history.js";
import {
  canonicalMessageId,
  emitContextIdentityDebug,
} from "../../../observability/context-identity-debug.js";
import { text } from "@noobot/shared/value";

export function buildContextMessageBlocks(agentContext, { currentUserMessage = null } = {}) {
  const runtime = getRuntimeFromAgentContext(agentContext);
  const context = getAgentContextEnvelope(agentContext);
  const systemRuntime = runtime?.systemRuntime || {};
  const runtimeParentSessionId = context.identity.parentSessionId;
  const currentUserMessageAttachments = resolveRuntimeUserMessageAttachments(runtime);
  const fallbackUserMeta = {
    userName: text(runtime?.systemRuntime?.userId),
    sessionId: context.identity.sessionId,
    parentSessionId: runtimeParentSessionId,
    dialogProcessId: "",
    parentDialogProcessId: text(systemRuntime?.parentDialogProcessId),
    attachments: currentUserMessageAttachments,
    userMessageAttachments: currentUserMessageAttachments,
  };
  const messageBlocks = context.modelContext.messageBlocks;
  const systemMessages = Array.isArray(messageBlocks?.system) ? messageBlocks.system : [];
  const rawHistoryMessages = Array.isArray(messageBlocks?.history) ? messageBlocks.history : [];
  const restoredIncrementalMessages = Array.isArray(messageBlocks?.incremental)
    ? messageBlocks.incremental
    : [];
  const currentTurnScopeId = context.identity.turnScopeId;
  fallbackUserMeta.turnScopeId = currentTurnScopeId;
  const historyMessages = rawHistoryMessages;
  const resolvedDialogProcessId = context.identity.dialogProcessId;
  fallbackUserMeta.dialogProcessId = resolvedDialogProcessId;
  const currentCanonicalId = canonicalMessageId(currentUserMessage);
  emitContextIdentityDebug(runtime?.eventListener, "contextBuildInput", {
    messageUid: text(currentUserMessage?.messageUid),
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
    historyLimit: TURN_THRESHOLDS.session.mainModelHistoryRoundLimit,
  });
  emitContextIdentityDebug(runtime?.eventListener, "canonicalBlocksResolved", {
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
          noobotInternalMessageType: CONTEXT_INTERNAL_MESSAGE_TYPE.SYSTEM_CONTEXT,
        },
      }),
    );
  }
  const history = buildHistoryMessages({
    effectiveHistoryMessages: resolvedMainBlocks.history,
    runtime,
    fallbackUserMeta,
  });
  const incremental = buildHistoryMessages({
    effectiveHistoryMessages: resolvedMainBlocks.incremental,
    runtime,
    fallbackUserMeta,
    allowMessageAttachments: true,
  });
  const projectedIds = incremental.map(canonicalMessageId).filter(Boolean);
  emitContextIdentityDebug(runtime?.eventListener, "modelProjectionBuilt", {
    sourceMessageUid: text(currentUserMessage?.messageUid),
    contentProjectionId: projectedIds.find((id) => id === currentCanonicalId) || "",
    userMetaProjectionId:
      projectedIds.find((id) => id === `${currentCanonicalId}::user_meta`) || "",
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

export function buildContextMessages(agentContext, { currentUserMessage = null } = {}) {
  return buildContextMessageBlocks(agentContext, {
    currentUserMessage,
  }).messages;
}
