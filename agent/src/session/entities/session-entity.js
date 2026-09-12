/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { resolveContextMessageDialogProcessId } from "@noobot/context-protocol/message/codec";
import { normalizeTurnLifecycleEntity } from "@noobot/authoritative-state/domain";
import { normalizeAuthorityEventOutbox, validateProtocolEvent } from "@noobot/event-protocol";
import { assertSessionAggregateInvariants } from "@noobot/session-protocol";
import { normalizeDialogOrderEntity } from "./dialog-order-entity.js";
import { normalizeSelectedConnectorIds } from "@noobot/connector-protocol";
import { firstTextField, normalizeTextField, objectRecord } from "./entity-primitives.js";
import { normalizeMessagesEntity } from "./message-entity.js";


function normalizeSessionArtifactEvents(session = {}, sessionId = "") {
  const events = [];
  const eventIds = new Set();
  for (const envelope of Array.isArray(session?.sessionArtifactEvents)
    ? session.sessionArtifactEvents
    : []) {
    const validation = validateProtocolEvent(envelope);
    const eventId = normalizeTextField(envelope?.identity?.eventId);
    if (
      !validation.valid ||
      !validation.descriptor?.sessionArtifact ||
      (sessionId && normalizeTextField(envelope?.identity?.sessionId) !== sessionId) ||
      !eventId ||
      eventIds.has(eventId)
    ) {
      continue;
    }
    eventIds.add(eventId);
    events.push(envelope);
  }
  return events;
}


export function normalizeTurnTimingEntity(timing = {}) {
  if (!timing || typeof timing !== "object" || Array.isArray(timing)) return null;
  const turnScopeId = String(timing?.turnScopeId || "").trim();
  const dialogProcessId = resolveContextMessageDialogProcessId(timing);
  if (!turnScopeId) return null;
  const thinkingStartedAt = String(timing?.thinkingStartedAt || "").trim();
  const thinkingFinishedAt = String(timing?.thinkingFinishedAt || "").trim();
  const normalized = { turnScopeId, dialogProcessId };
  if (thinkingStartedAt) normalized.thinkingStartedAt = thinkingStartedAt;
  if (thinkingFinishedAt) normalized.thinkingFinishedAt = thinkingFinishedAt;
  return normalized;
}

export function normalizeTurnTimingsEntity(turnTimings = []) {
  const source = Array.isArray(turnTimings)
    ? turnTimings
    : Object.values(turnTimings && typeof turnTimings === "object" ? turnTimings : {});
  const byKey = new Map();
  for (const item of source) {
    const normalized = normalizeTurnTimingEntity(item);
    if (!normalized) continue;
    const key = normalized.turnScopeId;
    byKey.set(key, { ...(byKey.get(key) || {}), ...normalized });
  }
  return [...byKey.values()];
}

function normalizeTurnSummaryCheckpoints(checkpoints = {}, messages = []) {
  if (!checkpoints || typeof checkpoints !== "object" || Array.isArray(checkpoints)) return {};
  const normalized = {};
  for (const [scopeKey, value] of Object.entries(checkpoints)) {
    if (!value || typeof value !== "object" || Array.isArray(value)) continue;
    const turnScopeId = String(value.turnScopeId || scopeKey || "").trim();
    const dialogProcessId = String(value.dialogProcessId || "").trim();
    if (!turnScopeId || !dialogProcessId) continue;
    const checkpointRevision = Math.max(0, Number(value.checkpointRevision) || 0);
    const sessionMessages = Array.isArray(messages) ? messages : [];
    const allMessageUids = new Set(
      sessionMessages.map((message) => String(message?.messageUid || "").trim()).filter(Boolean),
    );
    const ownedMessageUids = new Set(
      sessionMessages
        .filter(
          (message) =>
            resolveContextMessageDialogProcessId(message) === dialogProcessId &&
            String(message?.turnScopeId || "").trim() === turnScopeId,
        )
        .map((message) => String(message?.messageUid || "").trim())
        .filter(Boolean),
    );
    if (!ownedMessageUids.size) continue;
    const receipts = (Array.isArray(value.receipts) ? value.receipts : [])
      .map((receipt) => {
        if (!receipt || typeof receipt !== "object" || Array.isArray(receipt)) return null;
        const checkpointId = String(receipt.checkpointId || "").trim();
        const requestHash = String(receipt.requestHash || "").trim();
        if (!checkpointId || !requestHash) return null;
        const persistedMessageUids = [
          ...new Set(
            (Array.isArray(receipt.persistedMessageUids) ? receipt.persistedMessageUids : [])
              .map((uid) => String(uid || "").trim())
              .filter(Boolean),
          ),
        ];
        const summarizedMessageUids = [
          ...new Set(
            (Array.isArray(receipt.summarizedMessageUids) ? receipt.summarizedMessageUids : [])
              .map((uid) => String(uid || "").trim())
              .filter(Boolean),
          ),
        ];
        if (persistedMessageUids.some((uid) => !ownedMessageUids.has(uid))) return null;
        if (summarizedMessageUids.some((uid) => !allMessageUids.has(uid))) return null;
        return {
          checkpointId,
          checkpointRevision: Math.max(0, Number(receipt.checkpointRevision) || 0),
          requestHash,
          persistedMessageUids,
          summarizedMessageUids,
          markedCount: Math.max(0, Number(receipt.markedCount) || 0),
          committedAt: String(receipt.committedAt || "").trim(),
        };
      })
      .filter(Boolean)
      .slice(-50);
    normalized[turnScopeId] = {
      dialogProcessId,
      turnScopeId,
      checkpointRevision,
      receipts,
    };
  }
  return normalized;
}

function resolveSessionNormalizationContext(session, { now, sessionId, parentSessionId }) {
  const nowValue = now();
  const shortMemoryCheckpoint = Number(session?.shortMemoryCheckpoint);
  return {
    nowValue,
    sessionId: firstTextField([session?.sessionId, sessionId]),
    parentSessionId: firstTextField([session?.parentSessionId, parentSessionId]),
    customTitle: normalizeTextField(session?.customTitle),
    shortMemoryCheckpoint: Number.isFinite(shortMemoryCheckpoint) ? shortMemoryCheckpoint : 0,
  };
}

function createNormalizedSessionEntity(session, context, messages) {
  const normalizedBase = { ...objectRecord(session) };

  delete normalizedBase.sessionArtifacts;
  return {
    ...normalizedBase,
    sessionId: context.sessionId,
    parentSessionId: context.parentSessionId,
    aggregateVersion: Math.max(0, Number(session?.aggregateVersion) || 0),
    caller: firstTextField([session?.caller, "user"]),
    modelAlias: String(session?.modelAlias || ""),
    currentTaskId: normalizeTextField(session?.currentTaskId),
    shortMemoryCheckpoint: context.shortMemoryCheckpoint,
    messages,
    dialogOrder: normalizeDialogOrderEntity(session?.dialogOrder || [], messages),
    turnTimings: normalizeTurnTimingsEntity(session?.turnTimings || []),
    turnLifecycle: normalizeTurnLifecycleEntity(session?.turnLifecycle || {}),
    authorityEventOutbox: normalizeAuthorityEventOutbox(session?.authorityEventOutbox || []),
    sessionArtifactEvents: normalizeSessionArtifactEvents(session, context.sessionId),
    selectedConnectorIds: normalizeSelectedConnectorIds(session?.selectedConnectorIds),
    createdAt: firstTextField([session?.createdAt, context.nowValue]),
    updatedAt: firstTextField([session?.updatedAt, context.nowValue]),
  };
}

export function normalizeSessionEntity(
  session = {},
  { now = () => new Date().toISOString(), sessionId = "", parentSessionId = "" } = {},
) {
  if ("version" in session || "revision" in session) {
    throw new TypeError(
      "legacy session version fields are not supported; run the session protocol migration",
    );
  }
  assertSessionAggregateInvariants(session);
  const context = resolveSessionNormalizationContext(session, { now, sessionId, parentSessionId });
  const normalizedMessages = normalizeMessagesEntity(session?.messages || [], now, {
    sessionId: context.sessionId,
  });
  const normalizedTurnSummaryCheckpoints = normalizeTurnSummaryCheckpoints(
    session?.turnSummaryCheckpoints || {},
    normalizedMessages,
  );
  const normalizedSession = createNormalizedSessionEntity(session, context, normalizedMessages);
  if (context.customTitle) normalizedSession.customTitle = context.customTitle;
  else delete normalizedSession.customTitle;
  if (Object.keys(normalizedTurnSummaryCheckpoints).length) {
    normalizedSession.turnSummaryCheckpoints = normalizedTurnSummaryCheckpoints;
  } else {
    delete normalizedSession.turnSummaryCheckpoints;
  }
  delete normalizedSession.turnTerminalCommits;
  return assertSessionAggregateInvariants(normalizedSession);
}

export function normalizeSessionTreeEntity(tree = {}, now = () => new Date().toISOString()) {
  const nodes = tree?.nodes && typeof tree.nodes === "object" ? { ...tree.nodes } : {};
  for (const [nodeId, node] of Object.entries(nodes)) {
    const normalizedNodeId = String(nodeId || "").trim();
    if (!normalizedNodeId) {
      delete nodes[nodeId];
      continue;
    }
    const normalizedChildren = Array.isArray(node?.children)
      ? Array.from(
          new Set(node.children.map((childId) => String(childId || "").trim()).filter(Boolean)),
        )
      : [];
    nodes[normalizedNodeId] = {
      ...node,
      sessionId: normalizedNodeId,
      parentSessionId: String(node?.parentSessionId || "").trim(),
      children: normalizedChildren,
    };
    if (normalizedNodeId !== nodeId) delete nodes[nodeId];
  }

  const roots = Object.values(nodes)
    .filter((node) => !String(node?.parentSessionId || "").trim())
    .map((node) => String(node?.sessionId || "").trim())
    .filter(Boolean);

  return {
    roots: Array.from(new Set(roots)),
    nodes,
    updatedAt: tree?.updatedAt || now(),
  };
}
