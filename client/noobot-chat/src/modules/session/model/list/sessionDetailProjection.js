/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { buildNormalizedDetailMessages } from "./detailMessages.js";
import { foldConversationMessages } from "../../../chat/model/messageModel.js";
import { selectTurnPresentations } from "../../../chat/runtime/engine/turnPresentation.js";
import { createTurnRuntimeRegistryState } from "../../../chat/runtime/run-state-machine/turnRuntimeRegistry.js";
import { createWorkflowNodeStateRegistry } from "../../../chat/stores/workflowEventOperations.js";
import { selectSessionContentMessages } from "@noobot/session-protocol/session-detail";
import { text } from "@noobot/shared/value";

export function buildSessionDetailProjection({
  sessionDetail = {},
  sessionDocs = [],
  makeViewMessage,
} = {}) {
  const messages = selectSessionContentMessages(sessionDetail);
  const sessionId = text(sessionDetail.sessionId);
  const normalizedMessages = buildNormalizedDetailMessages({
    detailMessages: messages,
    sessionDocs,
    rootSessionId: sessionId,
    makeViewMessage,
  });

  const foldedMessages = foldConversationMessages(normalizedMessages, (messageItem) =>
    makeViewMessage(messageItem, { sessionId }),
  );
  const projectedMessages = selectTurnPresentations({
    activeSession: {
      sessionId,
      messages: foldedMessages,
    },
    workflowRegistry: createWorkflowNodeStateRegistry(),
    turnRuntimeRegistry: createTurnRuntimeRegistryState(),
  });
  return {
    sessionId,
    messages: projectedMessages,
  };
}
