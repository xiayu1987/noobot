/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { isSameTurnStatus } from "../../entities/turn-status-entity.js";
import { resolveMessageDialogProcessId } from "../../../context/session/dialog-process-id-resolver.js";
import { normalizeAnchorValue } from "./anchor-utils.js";

export function resolveTurnTimingKey(item = {}) {
  return normalizeAnchorValue(item?.turnScopeId) || resolveMessageDialogProcessId(item);
}

export function upsertSessionTurnTiming(session = {}, timing = {}) {
  const turnScopeId = normalizeAnchorValue(timing?.turnScopeId);
  const dialogProcessId = resolveMessageDialogProcessId(timing);
  const thinkingStartedAt = normalizeAnchorValue(timing?.thinkingStartedAt);
  const thinkingFinishedAt = normalizeAnchorValue(timing?.thinkingFinishedAt);
  if ((!turnScopeId && !dialogProcessId) || (!thinkingStartedAt && !thinkingFinishedAt)) return;
  const incoming = {
    turnScopeId,
    dialogProcessId,
    ...(thinkingStartedAt ? { thinkingStartedAt } : {}),
    ...(thinkingFinishedAt ? { thinkingFinishedAt } : {}),
  };
  const incomingKey = resolveTurnTimingKey(incoming);
  const source = Array.isArray(session.turnTimings) ? session.turnTimings : [];
  let matched = false;
  session.turnTimings = source.map((item) => {
    if (resolveTurnTimingKey(item) !== incomingKey) return item;
    matched = true;
    return { ...item, ...incoming };
  });
  if (!matched) session.turnTimings.push(incoming);
}

export function pruneSessionTurnTimings(session = {}) {
  const messages = Array.isArray(session.messages) ? session.messages : [];
  const liveKeys = new Set(messages.map(resolveTurnTimingKey).filter(Boolean));
  session.turnTimings = (Array.isArray(session.turnTimings) ? session.turnTimings : [])
    .filter((item) => liveKeys.has(resolveTurnTimingKey(item)));
}

export function pruneSessionTurnStatuses(session = {}) {
  const messages = Array.isArray(session.messages) ? session.messages : [];
  session.turnStatuses = (Array.isArray(session.turnStatuses) ? session.turnStatuses : [])
    .filter((status) => messages.some((message) => isSameTurnStatus(status, message)));
}
