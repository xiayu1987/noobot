/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { SystemMessage } from "@langchain/core/messages";
import { buildCanonicalMessageBlocks } from "@noobot/context-protocol/policy/block";
import { CONTEXT_INTERNAL_MESSAGE_TYPE } from "@noobot/context-protocol/message/internal-types";
import { TURN_THRESHOLDS } from "@noobot/shared/turn-thresholds";
import {
  getAgentContextEnvelope,
  getRuntimeFromAgentContext,
} from "../../agent-context-accessor.js";
import { buildHistoryMessages } from "./history.js";
import { resolveContextMessageId } from "@noobot/context-protocol/message/codec";
import { emitContextIdentityDebug } from "../../../observability/context-identity-debug.js";
import { text } from "@noobot/shared/value";

export function buildContextMessageBlocks(agentContext, { currentUserMessage = null } = {}) {
  const runtime = getRuntimeFromAgentContext(agentContext);
  const context = getAgentContextEnvelope(agentContext);
  const {
    system: systemMessages,
    history: historyMessages,
    incremental: restoredIncrementalMessages,
  } = context.modelContext.messageBlocks;
  const currentCanonicalId = resolveContextMessageId(currentUserMessage);
  emitContextIdentityDebug(runtime?.eventListener, "contextBuildInput", {
    messageUid: text(currentUserMessage?.messageUid),
    currentCanonicalId,
    systemCount: systemMessages.length,
    historyCount: historyMessages.length,
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
      (message) => resolveContextMessageId(message) === currentCanonicalId,
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
  });
  const incremental = buildHistoryMessages({
    effectiveHistoryMessages: resolvedMainBlocks.incremental,
    runtime,
  });
  const projectedIds = incremental.map(resolveContextMessageId).filter(Boolean);
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
  };
}

export function buildContextMessages(agentContext, { currentUserMessage = null } = {}) {
  return buildContextMessageBlocks(agentContext, {
    currentUserMessage,
  }).messages;
}
