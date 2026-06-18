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

handleReconnect(socket, payload = {}) {
  const lastReceivedSeqMap = payload?.lastReceivedSeqMap || {};
  const currentSessionId = String(payload?.currentSessionId || "").trim();
  const reconnectChannelKeys = this._resolveReconnectChannelKeys(socket, currentSessionId);
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
    this.attachSubscriber(channel, socket);

    const channelSessionId = this._extractSessionIdFromChannelKey(channelKey);
    if (!channelSessionId) continue;

    if (!sessionsMap.has(channelSessionId)) {
      sessionsMap.set(channelSessionId, {
        sessionId: channelSessionId,
        hasRunningTask: false,
        dialogProcesses: [],
        conversationStates: [],
      });
    }

    const sessionEntry = sessionsMap.get(channelSessionId);
    if (
      channel.status === CHANNEL_STATUS.RUNNING ||
      channel.status === CHANNEL_STATUS.CONNECTING
    ) {
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
        state: derivedSessionState,
        sourceEvent: CONVERSATION_SOURCE_EVENT.CHANNEL_STATUS,
        seq: Number(channel?.eventSequence || 0),
        updatedAtMs: Number(channel?.updatedAtMs || nowMs()),
      };
      if (existingSessionScopeStateIndex < 0) {
        sessionEntry.conversationStates.push(nextSessionScopeState);
      } else {
        sessionEntry.conversationStates[existingSessionScopeStateIndex] = nextSessionScopeState;
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
      if (lastSeq <= 0 && isTerminalStatus(channel.status)) {
        continue;
      }

      // Find events for this dialogProcessId with seq > lastSeq
      const missingEvents = channel.eventLog.filter((envelope) => {
        const envDpId = String(envelope?.data?.dialogProcessId || "").trim();
        if (envDpId !== dpId) return false;

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
              const requestId = String(envelope?.data?.requestId || "").trim();
              return envDpId === dpId && requestId && !missingRequestIds.has(requestId);
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
          messages: replayEvents.slice(0, config.maxReplayEvents),
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

_resolveReconnectChannelKeys(socket, currentSessionId = "") {
  const currentSocketChannelKeys = Array.from(
    socket?.__agentProxyChannelKeys instanceof Set ? socket.__agentProxyChannelKeys : [],
  ).filter(Boolean);
  if (currentSocketChannelKeys.length) {
    return currentSocketChannelKeys;
  }
  const normalizedCurrentSessionId = String(currentSessionId || "").trim();
  const requesterApiKey = String(socket?.__agentProxyApiKey || "").trim();
  const requesterUserId = String(socket?.__agentProxyUserId || "").trim();
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
