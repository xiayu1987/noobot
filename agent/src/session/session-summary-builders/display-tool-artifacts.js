/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { compactThinkingTimeline } from "./message-summary-projection.js";
import { buildToolArtifactTimelineProjection } from "./turn-artifact-projection.js";

function text(value) {
  return String(value || "").trim();
}

function selectArtifactPresentation(displayMessages, sessionId, routeKey, toolTimeline) {
  const candidates = displayMessages.filter(
    (message) =>
      text(message?.role) === "assistant" &&
      `${sessionId}::${text(message?.turnScopeId)}` === routeKey,
  );
  const dialogProcessIds = new Set(
    toolTimeline
      .map((item) => text(item?.resultEvent?.dialogProcessId || item?.call?.dialogProcessId))
      .filter(Boolean),
  );
  if (dialogProcessIds.size !== 1) return candidates.length === 1 ? candidates[0] : null;
  const matching = candidates.filter((message) => {
    const dialogProcessId = text(message?.dialogProcessId);
    return !dialogProcessId || dialogProcessIds.has(dialogProcessId);
  });
  return matching.length === 1 ? matching[0] : null;
}

function mergeArtifactTimeline(presentation, toolTimeline) {
  const canonicalTimeline = Array.isArray(presentation?.toolTimeline)
    ? presentation.toolTimeline
    : [];
  const canonicalByKey = new Map(
    canonicalTimeline.map((item, index) => [text(item?.key || item?.toolCallId), index]),
  );
  for (const artifact of toolTimeline) {
    const compactArtifact = compactThinkingTimeline([artifact])[0];
    const key = text(artifact?.key || artifact?.toolCallId);
    const index = canonicalByKey.get(key);
    if (index === undefined) {
      canonicalByKey.set(key, canonicalTimeline.length);
      canonicalTimeline.push(compactArtifact);
      continue;
    }
    canonicalTimeline[index] = {
      ...canonicalTimeline[index],
      resultEvent: {
        ...(canonicalTimeline[index]?.resultEvent || {}),
        ...compactArtifact?.resultEvent,
      },
    };
  }
  presentation.toolTimeline = canonicalTimeline;
}

export function attachSessionToolArtifacts(session, displayMessages, sessionId) {
  const { timelineByRoute, totalCount: toolLogCount } =
    buildToolArtifactTimelineProjection(session);
  let assignedToolArtifactCount = 0;
  let unassignedToolArtifactCount = 0;
  for (const [routeKey, toolTimeline] of timelineByRoute) {
    const presentation = selectArtifactPresentation(
      displayMessages,
      sessionId,
      routeKey,
      toolTimeline,
    );
    if (!presentation) {
      unassignedToolArtifactCount += toolTimeline.length;
      continue;
    }
    mergeArtifactTimeline(presentation, toolTimeline);
    assignedToolArtifactCount += toolTimeline.length;
  }
  return { toolLogCount, assignedToolArtifactCount, unassignedToolArtifactCount };
}
