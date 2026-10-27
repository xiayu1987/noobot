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
import {
  CONTEXT_MESSAGE_PROJECTION_TYPE,
  composeContextProjectionKey,
  assignContextMessageIdentity,
  resolveContextMessageIdentity,
  resolveContextMessageKey,
} from "@noobot/context-protocol/message/codec";
import { emitContextIdentityDebug } from "../../../observability/context-identity-debug.js";

function buildSystemContextMessage(source) {
  if (typeof source === "string") {
    return assignContextMessageIdentity(
      new SystemMessage({
        content: source,
        additional_kwargs: {
          noobotInternalMessageType: CONTEXT_INTERNAL_MESSAGE_TYPE.SYSTEM_CONTEXT,
        },
      }),
    );
  }
  const identity = Object.fromEntries(
    Object.entries(resolveContextMessageIdentity(source)).filter(([key]) => key !== "shape"),
  );
  if (typeof source?.content !== "string") {
    throw new TypeError(
      `restored system context message content must be a string: ${resolveContextMessageKey(source)}`,
    );
  }
  return new SystemMessage({
    content: source.content,
    additional_kwargs: {
      ...identity,
      noobotInternalMessageType: CONTEXT_INTERNAL_MESSAGE_TYPE.SYSTEM_CONTEXT,
    },
  });
}

export function buildContextMessageBlocks(agentContext, { currentUserMessage }) {
  const runtime = getRuntimeFromAgentContext(agentContext);
  const context = getAgentContextEnvelope(agentContext);
  const {
    system: systemMessages,
    history: historyMessages,
    incremental: restoredIncrementalMessages,
  } = context.modelContext.messageBlocks;

  const currentCanonicalId = currentUserMessage.messageUid;
  emitContextIdentityDebug(runtime?.eventListener, "contextBuildInput", {
    currentCanonicalId,
    systemCount: systemMessages.length,
    historyCount: historyMessages.length,
    restoredIncrementalCount: restoredIncrementalMessages.length,
    attachmentCount: currentUserMessage.attachments.length,
  });
  const resolvedMainBlocks = buildCanonicalMessageBlocks({
    systemMessages: systemMessages.map(buildSystemContextMessage),
    historyMessages,
    incrementalMessages: restoredIncrementalMessages,
    currentUserMessage,
    historyLimit: TURN_THRESHOLDS.session.mainModelHistoryRoundLimit,
  });
  emitContextIdentityDebug(runtime?.eventListener, "canonicalBlocksResolved", {
    currentCanonicalId,
    currentAlreadyInIncremental: restoredIncrementalMessages.some(
      (message) => resolveContextMessageKey(message) === currentCanonicalId,
    ),
    systemCount: resolvedMainBlocks.system.length,
    historyCount: resolvedMainBlocks.history.length,
    incrementalCount: resolvedMainBlocks.incremental.length,
  });

  const system = resolvedMainBlocks.system;
  const history = buildHistoryMessages({
    effectiveHistoryMessages: resolvedMainBlocks.history,
    runtime,
  });
  const incremental = buildHistoryMessages({
    effectiveHistoryMessages: resolvedMainBlocks.incremental,
    runtime,
  });
  const projectedIds = incremental.map(resolveContextMessageKey);
  const userMetaId = composeContextProjectionKey(
    CONTEXT_MESSAGE_PROJECTION_TYPE.USER_META,
    currentCanonicalId,
  );
  emitContextIdentityDebug(runtime?.eventListener, "modelProjectionBuilt", {
    sourceMessageUid: currentCanonicalId,
    contentProjectionFound: projectedIds.includes(currentCanonicalId),
    userMetaProjectionFound: projectedIds.includes(userMetaId),
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
