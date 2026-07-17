/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { config } from "../config.js";
import {
  CHANNEL_EVENT,
  CHANNEL_STATUS,
  CONVERSATION_SCOPE_KEY,
  CONVERSATION_STATE,
  CONVERSATION_SOURCE_EVENT,
  RECONNECT_SUGGESTION,
} from "../constants.js";
import { nowMs, isTerminalStatus } from "../utils.js";

class ReconnectMethods {
// ---- Reconnect ----

_isChannelExecutionAlive(channel) {
  if (!channel) return false;
  const status = String(channel.status || "").trim();
  const readyState = channel?.upstreamSocket?.readyState;
  // Older/in-memory fixtures may only carry a status. Once a real upstream has
  // been created, however, its socket lifecycle is the authoritative liveness
  // source and a missing/closed socket must not be treated as an active run.
  if (channel.upstreamEverConnected !== true && channel.upstreamClosed !== true) {
    return status === CHANNEL_STATUS.RUNNING || status === CHANNEL_STATUS.CONNECTING;
  }
  if (status === CHANNEL_STATUS.RUNNING) {
    return readyState === this.WebSocket.OPEN && channel.upstreamClosed !== true;
  }
  if (status === CHANNEL_STATUS.CONNECTING) {
    const connectingState = Number.isFinite(Number(this.WebSocket.CONNECTING))
      ? Number(this.WebSocket.CONNECTING)
      : 0;
    return (
      channel.upstreamClosed !== true &&
      (readyState === connectingState || readyState === this.WebSocket.OPEN)
    );
  }
  return false;
}

_convergeOrphanedActiveChannel(channel, sessionId = "") {
  const status = String(channel?.status || "").trim();
  const claimsActive =
    status === CHANNEL_STATUS.RUNNING || status === CHANNEL_STATUS.CONNECTING;
  if (!claimsActive || this._isChannelExecutionAlive(channel)) return false;

  const turnScopeId = String(channel?.startPayload?.turnScopeId || "").trim();
  const dialogProcessId = String(channel?.startPayload?.dialogProcessId || "").trim();
  this.markChannelTerminal(channel, CHANNEL_STATUS.ERROR);
  this.updateConversationState(channel, {
    sessionId,
    dialogProcessId,
    turnScopeId,
    state: CONVERSATION_STATE.ERROR,
    sourceEvent: CONVERSATION_SOURCE_EVENT.CHANNEL_STATUS,
    seq: Number(channel?.eventSequence || 0),
    broadcast: false,
  });
  this.logSessionEvent(channel, {
    category: "state",
    level: "warn",
    event: "agentProxy.channel.orphan.converged",
    data: {
      previousStatus: status,
      upstreamReadyState: channel?.upstreamSocket?.readyState ?? null,
      upstreamClosed: channel?.upstreamClosed === true,
    },
  });
  return true;
}

handleReconnect(socket, payload = {}) {
  const lastReceivedSeqMap = payload?.lastReceivedSeqMap || {};
  const lastReceivedTurnScopeIdMap = payload?.lastReceivedTurnScopeIdMap || {};
  const currentSessionId = String(payload?.currentSessionId || "").trim();
  const reconnectChannelKeys = this._resolveReconnectChannelKeys(socket, currentSessionId, payload);
  if (!reconnectChannelKeys.length) {
    this.sendSocketEvent(socket, {
      event: CHANNEL_EVENT.RECONNECT_DATA,
      data: {
        currentSessionId,
        sessions: [],
        cacheExpired: false,
        expiredDialogProcessIds: [],
        suggestion: RECONNECT_SUGGESTION.NONE,
      },
    });
    this.sendSocketEvent(socket, {
      event: CHANNEL_EVENT.RECONNECT_COMPLETE,
      data: {
        totalSessions: 0,
        cacheExpired: false,
      },
    });
    return;
  }

  const sessionsMap = new Map();
  const expiredDialogProcessIds = [];

  for (const channelKey of reconnectChannelKeys) {
    const channel = this.channelStore.get(channelKey);
    if (!channel) continue;

    const channelSessionId = this._extractSessionIdFromChannelKey(channelKey);
    if (!channelSessionId) continue;

    // Channel status is only a projection. After a refresh/restart the upstream
    // execution may already be gone while the cached channel still says running.
    // Converge that orphan before producing reconnect state so clients cannot
    // resurrect a non-existent run as sending/stopping forever.
    this._convergeOrphanedActiveChannel(channel, channelSessionId);

    const preAttachSessionState =
      channel.status === CHANNEL_STATUS.CONNECTING
        ? CONVERSATION_STATE.RECONNECTING
        : channel.status === CHANNEL_STATUS.RUNNING
        ? CONVERSATION_STATE.SENDING
        : "";
    if (preAttachSessionState) {
      this.updateConversationState(channel, {
        sessionId: channelSessionId,
        dialogProcessId: "",
        turnScopeId: String(channel?.startPayload?.turnScopeId || "").trim(),
        state: preAttachSessionState,
        sourceEvent: CONVERSATION_SOURCE_EVENT.CHANNEL_STATUS,
        seq: Number(channel?.eventSequence || 0),
        createdAtMs: Number(channel?.createdAtMs || channel?.updatedAtMs || nowMs()),
        broadcast: false,
      });
    }

    this.attachSubscriber(channel, socket);

    if (!sessionsMap.has(channelSessionId)) {
      sessionsMap.set(channelSessionId, {
        sessionId: channelSessionId,
        hasRunningTask: false,
        currentRun: null,
        dialogProcesses: [],
        conversationStates: [],
      });
    }

    const sessionEntry = sessionsMap.get(channelSessionId);
    const isActiveChannel =
      channel.status === CHANNEL_STATUS.RUNNING ||
      channel.status === CHANNEL_STATUS.CONNECTING;
    if (isActiveChannel) {
      sessionEntry.hasRunningTask = true;
    }
    const stateByDialogProcessId = new Map(
      (Array.isArray(sessionEntry?.conversationStates) ? sessionEntry.conversationStates : []).map(
        (item) => [
          String(item?.dialogProcessId || "").trim() || CONVERSATION_SCOPE_KEY,
          item,
        ],
      ),
    );
    for (const stateItem of channel.conversationStateByDialogProcessId.values()) {
      const stateKey =
        String(stateItem?.dialogProcessId || "").trim() || CONVERSATION_SCOPE_KEY;
      const existingStateItem = stateByDialogProcessId.get(stateKey);
      if (
        !existingStateItem ||
        Number(stateItem?.updatedAtMs || 0) >= Number(existingStateItem?.updatedAtMs || 0)
      ) {
        stateByDialogProcessId.set(
          stateKey,
          this._buildConversationStatePayload(
            channel,
            {
              ...stateItem,
              sessionId: channelSessionId,
            },
            {
              updatedAtMs: Number(stateItem?.updatedAtMs || 0),
            },
          ),
        );
      }
    }
    sessionEntry.conversationStates = Array.from(stateByDialogProcessId.values()).sort(
      (left, right) => Number(left?.updatedAtMs || 0) - Number(right?.updatedAtMs || 0),
    );
    const derivedSessionState =
      channel.status === CHANNEL_STATUS.CONNECTING
        ? CONVERSATION_STATE.RECONNECTING
        : channel.status === CHANNEL_STATUS.RUNNING
        ? CONVERSATION_STATE.SENDING
        : channel.status === CHANNEL_STATUS.IDLE
        ? CONVERSATION_STATE.NO_CONVERSATION
        : "";
    if (derivedSessionState) {
      const existingSessionScopeStateIndex = sessionEntry.conversationStates.findIndex(
        (stateItem) => !String(stateItem?.dialogProcessId || "").trim(),
      );
      const nextSessionScopeState = {
        sessionId: channelSessionId,
        dialogProcessId: "",
        turnScopeId: String(channel?.startPayload?.turnScopeId || "").trim(),
        state: derivedSessionState,
        sourceEvent: CONVERSATION_SOURCE_EVENT.CHANNEL_STATUS,
        seq: Number(channel?.eventSequence || 0),
        createdAtMs: Number(channel?.createdAtMs || channel?.updatedAtMs || nowMs()),
        updatedAtMs: Number(channel?.updatedAtMs || nowMs()),
      };
      if (existingSessionScopeStateIndex < 0) {
        sessionEntry.conversationStates.push(nextSessionScopeState);
      } else {
        sessionEntry.conversationStates[existingSessionScopeStateIndex] = nextSessionScopeState;
      }
    }

    const channelTurnScopeId = String(channel?.startPayload?.turnScopeId || "").trim();
    if (channelTurnScopeId) {
      const currentRunStates = sessionEntry.conversationStates
        .filter(
          (stateItem) =>
            String(stateItem?.turnScopeId || "").trim() === channelTurnScopeId,
        )
        .sort(
          (left, right) =>
            Number(right?.updatedAtMs || right?.seq || 0) -
            Number(left?.updatedAtMs || left?.seq || 0),
        );
      const currentRunState = currentRunStates[0];
      if (currentRunState) {
        const currentDialogState = currentRunStates.find(
          (stateItem) => String(stateItem?.dialogProcessId || "").trim(),
        );
        const nextCurrentRun = {
          ...currentRunState,
          sessionId: channelSessionId,
          dialogProcessId: String(
            channel?.startPayload?.dialogProcessId ||
              currentDialogState?.dialogProcessId ||
              "",
          ).trim(),
          turnScopeId: channelTurnScopeId,
        };
        if (
          !sessionEntry.currentRun ||
          Number(nextCurrentRun.updatedAtMs || 0) >=
            Number(sessionEntry.currentRun.updatedAtMs || 0)
        ) {
          sessionEntry.currentRun = nextCurrentRun;
        }
      }
    }

    // Collect all dialogProcessIds from eventLog
    const dialogProcessIdsInLog = new Set();
    for (const envelope of channel.eventLog) {
      const dpId = String(envelope?.data?.dialogProcessId || "").trim();
      if (dpId) dialogProcessIdsInLog.add(dpId);
    }

    // Also add the channel key's dialogProcessId if available
    const parts = channelKey.split("::");
    if (parts.length >= 4 && parts[3]) {
      dialogProcessIdsInLog.add(parts[3]);
    }

    for (const dpId of dialogProcessIdsInLog) {
      const lastSeq = Number(lastReceivedSeqMap[dpId] || 0);
      const reconnectTurnScopeId = String(
        lastReceivedTurnScopeIdMap?.[dpId] || payload?.currentTurnScopeId || "",
      ).trim();
      if (lastSeq <= 0 && isTerminalStatus(channel.status)) {
        continue;
      }

      // Find events for this dialogProcessId with seq > lastSeq
      const missingEvents = channel.eventLog.filter((envelope) => {
        const envDpId = String(envelope?.data?.dialogProcessId || "").trim();
        if (envDpId !== dpId) return false;

        // Sequence numbers are only meaningful inside one run. A channel is reused
        // across turns, so never replay an envelope from another turn into the run
        // the client is resuming. Keep the legacy behaviour only for clients/events
        // that predate turnScopeId.
        const envelopeTurnScopeId = String(envelope?.data?.turnScopeId || "").trim();
        if (
          reconnectTurnScopeId &&
          envelopeTurnScopeId &&
          envelopeTurnScopeId !== reconnectTurnScopeId
        ) {
          return false;
        }

        // A terminal error is already represented by the conversation/current-run
        // snapshot. Replaying the error envelope makes reconnect itself fail and can
        // leak the previous failed attempt into a later retry of the same session.
        // Keep non-terminal/live errors unchanged; only suppress historical terminal
        // error envelopes during replay.
        if (
          isTerminalStatus(channel.status) &&
          String(envelope?.event || "").trim() === CHANNEL_EVENT.ERROR
        ) {
          return false;
        }

        // Reconnect replay should only include unresolved interaction requests.
        // Resolved requests are historical records and would reopen stale UI prompts.
        if (
          String(envelope?.event || "").trim() ===
          CHANNEL_EVENT.INTERACTION_REQUEST
        ) {
          const requestId = String(envelope?.data?.requestId || "").trim();
          if (!requestId || !channel.pendingInteractionRequests.has(requestId)) {
            return false;
          }
        }

        const upstreamSeq = Number(envelope?.data?.seq || 0);
        const proxySeq = Number(envelope?.sequence || 0);
        const comparableSequence = upstreamSeq > 0 ? upstreamSeq : proxySeq;
        return comparableSequence > lastSeq;
      });
      const missingRequestIds = new Set(
        missingEvents
          .map((envelope) => String(envelope?.data?.requestId || "").trim())
          .filter(Boolean),
      );
      const pendingInteractionEvents = isTerminalStatus(channel.status)
        ? []
        : Array.from(channel.pendingInteractionRequests.values())
            .filter((envelope) => {
              const envDpId = String(envelope?.data?.dialogProcessId || "").trim();
              const envelopeTurnScopeId = String(envelope?.data?.turnScopeId || "").trim();
              const requestId = String(envelope?.data?.requestId || "").trim();
              const matchesRun =
                !reconnectTurnScopeId ||
                !envelopeTurnScopeId ||
                envelopeTurnScopeId === reconnectTurnScopeId;
              return envDpId === dpId && matchesRun && requestId && !missingRequestIds.has(requestId);
            })
            .map((envelope) => ({
              ...envelope,
              data: {
                ...(envelope?.data || {}),
                __agentProxyPendingInteraction: true,
              },
            }));
      const replayEvents = [...missingEvents, ...pendingInteractionEvents].sort((left, right) => {
        const leftSeq = Number(left?.data?.seq || left?.sequence || 0);
        const rightSeq = Number(right?.data?.seq || right?.sequence || 0);
        return leftSeq - rightSeq;
      });

      if (replayEvents.length > 0) {
        sessionEntry.dialogProcesses.push({
          dialogProcessId: dpId,
          parentDialogProcessId: String(payload?.parentDialogProcessId || "").trim(),
          messages: replayEvents
            .slice(0, config.maxReplayEvents)
            .map((eventEnvelope) => this._withChannelSessionScope(channel, eventEnvelope)),
        });
      } else if (lastSeq > 0) {
        // DialogProcessId was known but no events found - may be expired
        expiredDialogProcessIds.push(dpId);
        sessionEntry.conversationStates.push({
          sessionId: channelSessionId,
          dialogProcessId: dpId,
          state: CONVERSATION_STATE.EXPIRED,
          sourceEvent: CONVERSATION_SOURCE_EVENT.RECONNECT_CACHE_EXPIRED,
          seq: Number(lastSeq || 0),
          updatedAtMs: nowMs(),
        });
      }
    }
  }

  const sessions = Array.from(sessionsMap.values());
  const cacheExpired = expiredDialogProcessIds.length > 0;

  this.sendSocketEvent(socket, {
    event: CHANNEL_EVENT.RECONNECT_DATA,
    data: {
      currentSessionId,
      sessions,
      cacheExpired,
      expiredDialogProcessIds,
      suggestion: cacheExpired
        ? RECONNECT_SUGGESTION.RELOAD_SESSION_HISTORY
        : RECONNECT_SUGGESTION.NONE,
    },
  });

  this.sendSocketEvent(socket, {
    event: CHANNEL_EVENT.RECONNECT_COMPLETE,
    data: {
      totalSessions: sessions.length,
      cacheExpired,
    },
  });
}

_resolveReconnectChannelKeys(socket, currentSessionId = "", payload = {}) {
  const currentSocketChannelKeys = Array.from(
    socket?.__agentProxyChannelKeys instanceof Set ? socket.__agentProxyChannelKeys : [],
  ).filter(Boolean);
  if (currentSocketChannelKeys.length) {
    return currentSocketChannelKeys;
  }
  const normalizedCurrentSessionId = String(currentSessionId || "").trim();
  const requesterApiKey = String(socket?.__agentProxyApiKey || "").trim();
  const requesterUserId = String(socket?.__agentProxyUserId || payload?.userId || "").trim();
  const resolvedChannelKeys = [];
  for (const [channelKey, channel] of this.channelStore.entries()) {
    if (!channel) continue;
    if (
      normalizedCurrentSessionId &&
      this._extractSessionIdFromChannelKey(channelKey) !== normalizedCurrentSessionId &&
      channel.status !== CHANNEL_STATUS.RUNNING &&
      channel.status !== CHANNEL_STATUS.CONNECTING &&
      !channel.pendingInteractionRequests?.size
    ) {
      continue;
    }
    if (!this.hasChannelPermission(channel, requesterApiKey, requesterUserId)) continue;
    resolvedChannelKeys.push(channelKey);
  }
  return resolvedChannelKeys;
}

_extractSessionIdFromChannelKey(channelKey = "") {
  const parts = String(channelKey || "").split("::");
  return parts.length >= 2 ? parts[1] : "";
}
}

export const reconnectMethods = Object.getOwnPropertyDescriptors(ReconnectMethods.prototype);
delete reconnectMethods.constructor;
