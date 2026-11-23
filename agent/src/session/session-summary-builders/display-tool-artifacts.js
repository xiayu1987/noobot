/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { compactThinkingTimeline } from "@noobot/event-protocol/tool-timeline";
import { buildToolArtifactTimelineProjection } from "./turn-artifact-projection.js";
import {
  isTransferIdentityConflict,
  mergeTransferEnvelopes,
} from "@noobot/semantic-transfer-protocol";
import { text } from "@noobot/shared/value";

function indexArtifactPresentations(displayMessages, sessionId, timelineByRoute) {
  const presentations = new Map();
  if (timelineByRoute.size === 0) return presentations;
  for (const message of displayMessages) {
    if (text(message?.role) !== "assistant") continue;
    const routeKey = `${sessionId}::${text(message?.turnScopeId)}`;
    if (!timelineByRoute.has(routeKey)) continue;
    const candidates = presentations.get(routeKey);
    if (candidates) candidates.push(message);
    else presentations.set(routeKey, [message]);
  }
  return presentations;
}

function selectArtifactPresentation(candidates, toolTimeline) {
  if (!candidates) return null;
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
  const toolEnvelopes = toolTimeline.flatMap((artifact) => artifact.transferEnvelopes);
  if (toolEnvelopes.length) {
    presentation.transferEnvelopes = mergeTransferEnvelopes(
      Array.isArray(presentation.transferEnvelopes) ? presentation.transferEnvelopes : [],
      toolEnvelopes,
    );
  }
  for (const artifact of toolTimeline) {
    const compactArtifact = compactThinkingTimeline([artifact])[0];
    const key = text(artifact?.key || artifact?.toolCallId);
    const index = canonicalByKey.get(key);
    if (index === undefined) {
      canonicalByKey.set(key, canonicalTimeline.length);
      canonicalTimeline.push(compactArtifact);
      continue;
    }
    const canonical = canonicalTimeline[index];
    canonicalTimeline[index] = {
      ...canonical,
      ...(!canonical.resultEvent
        ? { status: compactArtifact.status, success: compactArtifact.success }
        : {}),
      resultEvent: {
        ...compactArtifact.resultEvent,
        ...canonical.resultEvent,
      },
    };
  }
  presentation.toolTimeline = canonicalTimeline;
}

export function attachSessionToolArtifacts(session, displayMessages, sessionId) {
  const { timelineByRoute } = buildToolArtifactTimelineProjection(session);
  const presentations = indexArtifactPresentations(displayMessages, sessionId, timelineByRoute);
  let assignedToolArtifactCount = 0;
  let unassignedToolArtifactCount = 0;
  let conflictedToolArtifactCount = 0;
  for (const [routeKey, toolTimeline] of timelineByRoute) {
    const presentation = selectArtifactPresentation(presentations.get(routeKey), toolTimeline);
    if (!presentation) {
      unassignedToolArtifactCount += toolTimeline.length;
      continue;
    }
    try {
      mergeArtifactTimeline(presentation, toolTimeline);
    } catch (error) {
      if (!isTransferIdentityConflict(error)) throw error;
      presentation.toolArtifactConflict = error.code;
      conflictedToolArtifactCount += toolTimeline.length;
      continue;
    }
    assignedToolArtifactCount += toolTimeline.length;
  }
  return {
    assignedToolArtifactCount,
    unassignedToolArtifactCount,
    conflictedToolArtifactCount,
  };
}
