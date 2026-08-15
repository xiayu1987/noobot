/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { createAuthoritativeTurnSnapshot } from "@noobot/authoritative-state/application";
import {
  collectAttachmentRefsFromTransferEnvelopes,
  dedupeAttachmentRefs,
  dedupeSessionAttachmentRefs,
} from "../transfer-attachment-refs.js";
import { projectThinkingTimeline } from "../thinking-timeline-projection.js";
import {
  buildDisplayMessageSummary,
  buildThinkingDetailCountByMessage,
  compactThinkingTimeline,
} from "./message-summary-projection.js";
import {
  buildActiveTurnPresentation,
  buildToolArtifactTimelineProjection,
} from "./turn-artifact-projection.js";

export const SESSION_DISPLAY_SUMMARY_SCHEMA_VERSION = 22;
export const SESSION_DETAIL_MESSAGE_PROJECTION = "canonical-presentation";

export function isSessionDisplaySummaryPayload(payload = null, sessionId = "") {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return false;
  if (Number(payload?.schemaVersion || 0) !== SESSION_DISPLAY_SUMMARY_SCHEMA_VERSION) return false;
  const normalizedSessionId = String(sessionId || "").trim();
  if (normalizedSessionId && String(payload?.sessionId || "").trim() !== normalizedSessionId)
    return false;
  return true;
}

export function buildSessionDisplaySummary(session = {}) {
  const messages = Array.isArray(session?.messages) ? session.messages : [];
  const terminalTurnScopeIds = [
    ...new Set(
      messages.map((message) => String(message?.turnScopeId || "").trim()).filter(Boolean),
    ),
  ];
  const turnTimings = Array.isArray(session?.turnTimings) ? session.turnTimings : [];
  const turnStatuses = Array.isArray(session?.turnStatuses) ? session.turnStatuses : [];
  const sessionId = String(session?.sessionId || "").trim();
  const lifecycle =
    session?.turnLifecycle && typeof session.turnLifecycle === "object"
      ? session.turnLifecycle
      : null;
  const lifecycleTurns =
    lifecycle?.turns && typeof lifecycle.turns === "object" ? lifecycle.turns : {};
  const firstUserMessage = messages.find(
    (messageItem) =>
      messageItem?.injectedMessage !== true &&
      String(messageItem?.role || "")
        .trim()
        .toLowerCase() === "user" &&
      String(messageItem?.content || "").trim(),
  );
  const customTitle = String(session?.customTitle || "").trim();
  const thinkingDetailCountForMessage = buildThinkingDetailCountByMessage(messages);
  const projectedDisplayMessages = messages
    .map((message) => {
      const summary = buildDisplayMessageSummary(message);
      if (!summary || String(message?.role || "").trim() !== "assistant") return summary;
      const thinkingDetailCount = thinkingDetailCountForMessage(message);
      if (thinkingDetailCount > 0) {
        summary.thinkingDetailCount = thinkingDetailCount;
        summary.hasThinkingDetails = true;
      } else {
        delete summary.thinkingDetailCount;
        delete summary.hasThinkingDetails;
      }
      return summary;
    })
    .filter(Boolean);
  const activeTurnPresentation = buildActiveTurnPresentation(lifecycle, sessionId);
  if (activeTurnPresentation) {
    const presentationMessageId = activeTurnPresentation.presentationMessageId;
    const existingPresentation = projectedDisplayMessages.find(
      (message) =>
        String(message?.presentationMessageId || message?.messageId || message?.id || "").trim() ===
        presentationMessageId,
    );
    if (existingPresentation && String(existingPresentation?.role || "").trim() !== "assistant") {
      throw new TypeError("active Turn presentation invariant failed: presentation_role_conflict");
    }
    if (
      existingPresentation &&
      String(existingPresentation?.turnScopeId || "").trim() !== activeTurnPresentation.turnScopeId
    ) {
      throw new TypeError(
        "active Turn presentation invariant failed: presentation_turn_scope_conflict",
      );
    }
    if (!existingPresentation) {
      const owningUserIndex = projectedDisplayMessages.findLastIndex(
        (message) =>
          String(message?.role || "").trim() === "user" &&
          String(message?.turnScopeId || "").trim() === activeTurnPresentation.turnScopeId,
      );
      projectedDisplayMessages.splice(
        owningUserIndex >= 0 ? owningUserIndex + 1 : projectedDisplayMessages.length,
        0,
        activeTurnPresentation,
      );
    }
  }
  const displayMessageByIdentity = new Map();
  for (const message of projectedDisplayMessages) {
    const identity = String(
      message?.presentationMessageId || message?.messageId || message?.id || "",
    ).trim();
    if (!identity || message?.role !== "assistant") {
      displayMessageByIdentity.set(`${identity}:${displayMessageByIdentity.size}`, message);
      continue;
    }
    const existing = displayMessageByIdentity.get(identity);
    if (!existing) {
      displayMessageByIdentity.set(identity, message);
      continue;
    }
    const existingIsPlaceholder = Boolean(String(existing?.sourceMessageType || "").trim());
    const incomingIsPlaceholder = Boolean(String(message?.sourceMessageType || "").trim());
    const presentation = !incomingIsPlaceholder || existingIsPlaceholder ? message : existing;
    presentation.thinkingDetailCount = Math.max(
      Number(existing?.thinkingDetailCount || 0),
      Number(message?.thinkingDetailCount || 0),
    );
    presentation.hasThinkingDetails = presentation.thinkingDetailCount > 0;
    displayMessageByIdentity.set(identity, presentation);
  }
  const displayMessages = [...displayMessageByIdentity.values()];
  for (const displayMessage of displayMessages) {
    if (String(displayMessage?.role || "").trim() !== "assistant") continue;
    const turnScopeId = String(displayMessage?.turnScopeId || "").trim();
    if (!turnScopeId) continue;
    const thinkingTimeline = projectThinkingTimeline(messages, displayMessage, { turnScopeId });
    if (!thinkingTimeline.toolTimeline.length && !thinkingTimeline.activityTimeline.length)
      continue;
    displayMessage.toolTimeline = compactThinkingTimeline(thinkingTimeline.toolTimeline);
    if (thinkingTimeline.activityTimeline.length) {
      displayMessage.activityTimeline = thinkingTimeline.activityTimeline;
    } else {
      delete displayMessage.activityTimeline;
    }
    displayMessage.hasThinkingDetails = true;
    displayMessage.thinkingDetailCount =
      thinkingTimeline.toolTimeline.length + thinkingTimeline.activityTimeline.length;
  }
  const injectedCount = messages.filter((message) => message?.injectedMessage === true).length;
  const thinkingCount = displayMessages.filter(
    (message) => message?.hasThinkingDetails === true,
  ).length;
  const { timelineByRoute, totalCount: toolLogCount } =
    buildToolArtifactTimelineProjection(session);
  let unassignedToolArtifactCount = 0;
  let assignedToolArtifactCount = 0;
  for (const [routeKey, toolTimeline] of timelineByRoute) {
    const candidates = displayMessages.filter(
      (message) =>
        String(message?.role || "").trim() === "assistant" &&
        `${sessionId}::${String(message?.turnScopeId || "").trim()}` === routeKey,
    );
    const dialogProcessIds = new Set(
      toolTimeline
        .map((item) =>
          String(item?.resultEvent?.dialogProcessId || item?.call?.dialogProcessId || "").trim(),
        )
        .filter(Boolean),
    );
    const matchingCandidates =
      dialogProcessIds.size === 1
        ? candidates.filter((message) => {
            const dialogProcessId = String(message?.dialogProcessId || "").trim();
            return !dialogProcessId || dialogProcessIds.has(dialogProcessId);
          })
        : candidates;
    if (matchingCandidates.length !== 1) {
      unassignedToolArtifactCount += toolTimeline.length;
      continue;
    }
    const presentation = matchingCandidates[0];
    const canonicalTimeline = Array.isArray(presentation?.toolTimeline)
      ? presentation.toolTimeline
      : [];
    const canonicalByKey = new Map(
      canonicalTimeline.map((item, index) => [
        String(item?.key || item?.toolCallId || "").trim(),
        index,
      ]),
    );
    for (const artifact of toolTimeline) {
      const key = String(artifact?.key || artifact?.toolCallId || "").trim();
      const index = canonicalByKey.get(key);
      if (index === undefined) {
        canonicalByKey.set(key, canonicalTimeline.length);
        canonicalTimeline.push(compactThinkingTimeline([artifact])[0]);
      } else {
        canonicalTimeline[index] = {
          ...canonicalTimeline[index],
          resultEvent: {
            ...(canonicalTimeline[index]?.resultEvent || {}),
            ...compactThinkingTimeline([artifact])[0]?.resultEvent,
          },
        };
      }
    }
    presentation.toolTimeline = canonicalTimeline;
    assignedToolArtifactCount += toolTimeline.length;
  }
  const attachmentCount = displayMessages.reduce((count, message) => {
    const sessionAttachments = dedupeSessionAttachmentRefs(
      Array.isArray(message?.attachments) ? message.attachments : [],
    );
    const transferAttachments = dedupeAttachmentRefs([
      ...collectAttachmentRefsFromTransferEnvelopes(message?.transferEnvelopes),
      ...(Array.isArray(message?.toolTimeline)
        ? message.toolTimeline.flatMap((item) =>
            Array.isArray(item?.resultEvent?.attachments) ? item.resultEvent.attachments : [],
          )
        : []),
    ]);
    return count + sessionAttachments.length + transferAttachments.length;
  }, 0);
  const turnLifecycleSnapshot = lifecycle
    ? createAuthoritativeTurnSnapshot({
        lifecycle,
        turnTimings,
        terminalTurnScopeIds,
        commandId: `session-summary:${sessionId}:${Number(lifecycle?.sequence || 0)}`,
        sessionId,
        generatedAt: String(session?.updatedAt || "").trim(),
      })
    : null;
  return {
    schemaVersion: SESSION_DISPLAY_SUMMARY_SCHEMA_VERSION,
    sessionId,
    parentSessionId: String(session?.parentSessionId || "").trim(),
    caller: String(session?.caller || "user").trim() || "user",
    currentTaskId: String(session?.currentTaskId || "").trim(),
    createdAt: String(session?.createdAt || "").trim(),
    updatedAt: String(session?.updatedAt || "").trim(),
    title:
      customTitle ||
      (firstUserMessage
        ? String(firstUserMessage.content || "").slice(0, 20)
        : sessionId.slice(0, 8)),
    aggregateVersion: session?.aggregateVersion,
    turnTimings,
    turnStatuses,
    turnLifecycleSnapshot,
    messages: displayMessages,
    stats: {
      messageCount: messages.length,
      displayMessageCount: displayMessages.length,
      injectedMessageCount: injectedCount,
      thinkingMessageCount: thinkingCount,
      toolLogCount,
      displayToolLogCount: assignedToolArtifactCount,
      unassignedToolArtifactCount,
      hasToolDetails: toolLogCount > 0,
      attachmentCount,
    },
  };
}
