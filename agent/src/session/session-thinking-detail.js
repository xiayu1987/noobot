/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { requireTurnPartitionIdentity } from "@noobot/session-protocol";
import { createTurnArtifactRevision } from "@noobot/session-protocol/turn-lookup-key";
import { countCanonicalThinkingDetailEvents } from "@noobot/event-protocol/tool-timeline";
import { isThinkingDetailInjectedMessage } from "@noobot/event-protocol/thinking-detail-content";
import { readSessionTurn } from "./session-artifact-session.js";
import { projectThinkingTimeline } from "./thinking-timeline-projection.js";

function hasThinkingTimeline(message) {
  return (
    Array.isArray(message.toolTimeline) ||
    Array.isArray(message.activityTimeline) ||
    Array.isArray(message.thinkingContentTimeline)
  );
}

export function buildThinkingDetailPayload(turn) {
  if (turn === null) return { exists: false };
  const { presentationMessageId } = requireTurnPartitionIdentity(turn.messages);
  const { roundMessages, toolTimeline, activityTimeline, thinkingContentTimeline } =
    projectThinkingTimeline(turn.messages, { turnScopeId: turn.turnScopeId });
  const injectedMessages = roundMessages.filter(isThinkingDetailInjectedMessage);
  const detailMessages = roundMessages.filter(
    (message) => isThinkingDetailInjectedMessage(message) || hasThinkingTimeline(message),
  );
  const thinkingDetailCount = countCanonicalThinkingDetailEvents({
    toolTimeline,
    activityTimeline,
  });
  return {
    exists: true,
    sessionId: turn.sessionId,
    revision: createTurnArtifactRevision(turn),
    messageItem: {
      sessionId: turn.sessionId,
      turnScopeId: turn.turnScopeId,
      dialogProcessId: turn.dialogProcessId,
      presentationMessageId,
      toolTimeline,
      activityTimeline,
      thinkingContentTimeline,
      hasThinkingDetails: thinkingDetailCount > 0 || thinkingContentTimeline.length > 0,
    },
    counts: {
      executionLogCount: countCanonicalThinkingDetailEvents({ toolTimeline }),
      injectedMessageCount: injectedMessages.length,
      thinkingContentCount: thinkingContentTimeline.length,
      messageCount: detailMessages.length,
    },
  };
}

export async function readSessionThinkingDetail({
  storageService,
  sessionDir,
  turnScopeId,
  dialogProcessId,
}) {
  return buildThinkingDetailPayload(
    await readSessionTurn({ storageService, sessionDir, turnScopeId, dialogProcessId }),
  );
}
