/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { getMessageContentIdentity } from "./messageIdentity.js";
import { normalizeStatusStepDisplayState } from "./messagePresentation.js";

function pickOwnFields(canonicalMessage, fields) {
  return Object.fromEntries(
    fields
      .filter((field) => Object.hasOwn(canonicalMessage, field))
      .map((field) => [field, canonicalMessage[field]]),
  );
}

function buildMessageContentFacet(canonicalMessage = {}) {
  return {
    ...pickOwnFields(canonicalMessage, [
      "type",
      "chatPresentation",
      "workspaceRootDirectory",
      "tool_call_id",
      "thinking",
      "toolCall",
      "toolResult",
      "tool_calls",
      "rawEvents",
    ]),
    content: getMessageContentIdentity(canonicalMessage),
  };
}

function buildMessageModelRunFacet(canonicalMessage = {}) {
  return pickOwnFields(canonicalMessage, ["modelAlias", "modelName", "modelRuns"]);
}

function buildMessageTimelineFacet(canonicalMessage = {}) {
  return pickOwnFields(canonicalMessage, [
    "toolTimeline",
    "activityTimeline",
    "thinkingContentTimeline",
    "thinkingDetailRef",
    "hasThinkingDetails",
  ]);
}

const MESSAGE_STATUS_FIELDS = Object.freeze([
  "error",
  "toolArtifactConflict",
  "pending",
  "synthetic",
  "placeholder",
  "turnPlaceholder",
  "channelState",
  "terminalOutcome",
  "statusTurnScopeId",
  "hasFirstStreamEvent",
]);

function buildMessageStatusFacet(canonicalMessage) {
  return {
    ...pickOwnFields(canonicalMessage, MESSAGE_STATUS_FIELDS),
    projectedStatusStepState: normalizeStatusStepDisplayState(
      canonicalMessage.projectedStatusStepState,
    ),
  };
}

const MESSAGE_ORIGIN_FIELDS = Object.freeze([
  "noobotInternalMessageType",
  "messageOrigin",
  "injectedMessage",
  "injectedBy",
  "injectedMessageType",
  "interjectionSequence",
  "pluginMessage",
  "pluginMeta",
]);

function buildMessageOriginFacet(canonicalMessage) {
  return pickOwnFields(canonicalMessage, MESSAGE_ORIGIN_FIELDS);
}

export {
  pickOwnFields,
  buildMessageContentFacet,
  buildMessageModelRunFacet,
  buildMessageOriginFacet,
  buildMessageStatusFacet,
  buildMessageTimelineFacet,
};
