/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { requireTurnPartitionIdentity } from "@noobot/session-protocol/turn-partition-identity";
import { requireCanonicalTurnScopeId } from "@noobot/session-protocol/turn-scope-identity";
import { createTurnArtifactRevision } from "@noobot/session-protocol/turn-lookup-key";
import {
  collectCanonicalActivityVersions,
  selectMessageActivityTimeline,
} from "./activity-timeline.js";
import {
  countCanonicalThinkingDetailEvents,
  requireCanonicalToolTimelineIdentity,
  selectMessageToolTimeline,
} from "./tool-timeline.js";
import {
  isThinkingDetailInjectedMessage,
  mergeThinkingDetailContentFragments,
  projectThinkingDetailContentFragment,
} from "./thinking-detail-content.js";

function mergeToolTimeline(messages, selectToolTimeline) {
  const timeline = [];
  const indexByKey = new Map();
  for (const message of messages) {
    for (const item of selectToolTimeline(message)) {
      const { key } = requireCanonicalToolTimelineIdentity(item);
      if (!indexByKey.has(key)) {
        indexByKey.set(key, timeline.length);
        timeline.push(item);
      } else {
        const index = indexByKey.get(key);
        timeline[index] = { ...timeline[index], ...item };
      }
    }
  }
  return timeline;
}

function* activityFacts(messages) {
  for (const message of messages) yield* selectMessageActivityTimeline(message);
}

export function projectThinkingEventTimeline(
  roundMessages,
  selectToolTimeline = selectMessageToolTimeline,
) {
  const toolTimeline = mergeToolTimeline(roundMessages, selectToolTimeline);
  const activityTimeline = collectCanonicalActivityVersions(activityFacts(roundMessages)).sort(
    (left, right) => left.sequence - right.sequence,
  );
  return { toolTimeline, activityTimeline };
}

export function projectThinkingTimeline(messages, { turnScopeId, after = 0 }) {
  const scope = requireCanonicalTurnScopeId(turnScopeId);
  const roundMessages = messages.filter((message) => message.turnScopeId === scope);
  const toolTimeline = mergeToolTimeline(roundMessages, selectMessageToolTimeline);
  const { activityTimeline, thinkingContentTimeline } = mergeThinkingDetailContentFragments([
    projectThinkingDetailContentFragment({
      messages: roundMessages,
      activityTimeline: roundMessages.flatMap(selectMessageActivityTimeline),
      after,
    }),
  ]);
  return { roundMessages, toolTimeline, activityTimeline, thinkingContentTimeline };
}

function hasThinkingTimeline(message) {
  return (
    Array.isArray(message.toolTimeline) ||
    Array.isArray(message.activityTimeline) ||
    Array.isArray(message.thinkingContentTimeline)
  );
}

export function buildThinkingDetailPayload(turn, { after = 0 } = {}) {
  if (turn === null) return { exists: false };
  const { presentationMessageId } = requireTurnPartitionIdentity(turn.messages);
  const { roundMessages, toolTimeline, activityTimeline, thinkingContentTimeline } =
    projectThinkingTimeline(turn.messages, { turnScopeId: turn.turnScopeId, after });
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

export function buildThinkingDetailPagePayload(page, selection) {
  if (page.exists === false) return { exists: false };
  const after = selection.cursor === null ? 0 : selection.cursor.after;
  return {
    ...buildThinkingDetailPayload(
      {
        ...page,
        contentRevision: JSON.stringify([page.sessionId, page.generation, after]),
      },
      { after },
    ),
    page: {
      generation: page.generation,
      messageCount: page.messageCount,
      after,
      count: page.messages.length,
      nextCursor: page.nextCursor,
    },
  };
}
