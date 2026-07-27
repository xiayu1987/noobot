/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { StreamEventEnum } from "../../shared/constants/chatConstants.js";

export function createReconnectCursorStore() {
  let lastReceivedSeqMap = {};
  let lastReceivedTurnScopeIdMap = {};

  function getSeqMap() {
    return { ...lastReceivedSeqMap };
  }

  function getTurnScopeIdMap() {
    return { ...lastReceivedTurnScopeIdMap };
  }

  function clear() {
    lastReceivedSeqMap = {};
    lastReceivedTurnScopeIdMap = {};
  }

  function hasState() {
    return Object.keys(lastReceivedSeqMap).length > 0;
  }

  function update(dialogProcessId, seq, turnScopeId = "") {
    const dpId = String(dialogProcessId || "").trim();
    if (!dpId) return;
    const currentSeq = Number(lastReceivedSeqMap[dpId] || 0);
    if (Number(seq || 0) > currentSeq) lastReceivedSeqMap[dpId] = Number(seq);
    const normalizedTurnScopeId = String(turnScopeId || "").trim();
    if (normalizedTurnScopeId) lastReceivedTurnScopeIdMap[dpId] = normalizedTurnScopeId;
  }

  function trackEvent(data = {}) {
    const dialogProcessId = String(data?.dialogProcessId || "").trim();
    const sequence = Number(data?.seq || 0);
    if (dialogProcessId && sequence > 0) update(dialogProcessId, sequence, data?.turnScopeId);
  }

  function remove(dialogProcessId) {
    const dpId = String(dialogProcessId || "").trim();
    if (!dpId) return;
    delete lastReceivedSeqMap[dpId];
    delete lastReceivedTurnScopeIdMap[dpId];
  }

  function trackReconnectData(data = {}) {
    const sessions = Array.isArray(data?.sessions) ? data.sessions : [];
    for (const sessionEntry of sessions) {
      const dialogProcesses = Array.isArray(sessionEntry?.dialogProcesses)
        ? sessionEntry.dialogProcesses
        : [];
      for (const dialogProcess of dialogProcesses) {
        const dialogProcessId = String(dialogProcess?.dialogProcessId || "").trim();
        const messages = Array.isArray(dialogProcess?.messages) ? dialogProcess.messages : [];
        for (const envelope of messages) {
          const event = String(envelope?.event || "").trim();
          const eventData = envelope?.data && typeof envelope.data === "object" ? envelope.data : {};
          trackEvent({
            ...eventData,
            dialogProcessId: String(eventData?.dialogProcessId || dialogProcessId || "").trim(),
          });
          if (event === StreamEventEnum.DONE || event === StreamEventEnum.USER_STOPPED) {
            remove(dialogProcessId || eventData?.dialogProcessId || "");
          }
        }
      }
    }
  }

  return { clear, getSeqMap, getTurnScopeIdMap, hasState, remove, trackEvent, trackReconnectData };
}
