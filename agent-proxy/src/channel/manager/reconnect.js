/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { config } from "../../shared/config.js";
import { CHANNEL_STATUS } from "../../shared/constants.js";
import { createChannelKey, nowMs } from "../../shared/utils.js";
import { writeAgentProxyRouteLifecycleEvent } from "../../runtime-events/ws-runtime-events.js";
import {
  groupReconnectChannels,
  logPreparedAuthorityBatches,
  prepareSessionReplays,
} from "./reconnect/session-replay.js";
import {
  applySnapshotResults,
  createReconnectTransaction,
  settleSnapshotRequests,
} from "./reconnect/snapshot-transaction.js";
import {
  publishEmptyReconnect,
  publishReconnectTransaction,
} from "./reconnect/reconnect-publisher.js";
import { text } from "@noobot/shared/value";

function cancelSupersededReconnect(manager, socket) {
  manager.clearPendingLifecycleDeliveries(socket);
  const supersededTransaction = socket.__agentProxyReconnectTransaction;
  socket.__agentProxyReconnectTransaction = null;
  supersededTransaction?.cancel?.("reconnect_superseded");
}

function hasSessionChannel(manager, sessionId) {
  return Boolean(
    sessionId &&
    Array.from(manager.channelStore.values()).some(
      (channel) => channel.identity.sessionId === sessionId,
    ),
  );
}

async function provisionReconnectChannel(manager, socket, session) {
  const userId = text(socket?.__agentProxyUserId);
  if (!userId) return [];
  const channelKey = createChannelKey({
    userId,
    sessionId: session.sessionId,
    parentSessionId: session.parentSessionId,
    parentDialogProcessId: session.parentDialogProcessId,
  });
  const channel = manager.ensureChannel(channelKey, { sessionId: session.sessionId, userId });
  const apiKey = text(socket?.__agentProxyApiKey);
  if (!channel || !manager.hasChannelPermission(channel, apiKey, userId)) return [];
  manager.connectUpstreamChannel(channel, apiKey, text(socket?.__agentProxyLocale), {
    initialPayload: null,
    purpose: "reconnect_session",
  });
  const deadline = nowMs() + config.reconnectSnapshotTimeoutMs;
  while (channel.upstreamSocket?.readyState !== manager.WebSocket.OPEN && nowMs() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return [channelKey];
}

function attachReconnectBaselines(manager, socket, channelKeys, transaction) {
  for (const channelKey of channelKeys) {
    const channel = manager.channelStore.get(channelKey);
    if (!channel) continue;
    manager.attachSubscriber(channel, socket, { sendStateSnapshot: false });
    transaction.channelStateBaseline.push(...manager.buildChannelStateSnapshot(channel));
  }
}

function isReconnectChannelCandidate(manager, channelKey, channel, currentSessionId) {
  if (!channel) return false;
  if (!currentSessionId) return true;
  if (channel.identity.sessionId === currentSessionId) return true;
  return (
    channel.activity.phase === CHANNEL_STATUS.RUNNING ||
    channel.transport.phase === CHANNEL_STATUS.CONNECTING ||
    Boolean(channel.pendingInteractionRequests?.size)
  );
}

class ReconnectMethods {
  async handleReconnect(socket, control) {
    const { identity } = control;
    const currentSessionId = identity.sessionId;
    cancelSupersededReconnect(this, socket);
    let reconnectChannelKeys = this._resolveReconnectChannelKeys(socket, currentSessionId);
    if (
      !reconnectChannelKeys.length &&
      currentSessionId &&
      !hasSessionChannel(this, currentSessionId)
    ) {
      reconnectChannelKeys = await provisionReconnectChannel(this, socket, {
        sessionId: currentSessionId,
        parentSessionId: identity.parentSessionId,
        parentDialogProcessId: identity.parentDialogProcessId,
      });
    }
    void writeAgentProxyRouteLifecycleEvent({
      event: "agentProxy.route.reconnect.started",
      socket,
      data: {
        currentSessionIdPresent: Boolean(currentSessionId),
        channelCount: reconnectChannelKeys.length,
      },
    });
    if (!reconnectChannelKeys.length) {
      publishEmptyReconnect(this, socket, control);
      return;
    }
    const snapshotRequests = [];
    const reconnectTransaction = createReconnectTransaction(snapshotRequests);
    socket.__agentProxyReconnectTransaction = reconnectTransaction;
    const channelsBySessionId = groupReconnectChannels(this, reconnectChannelKeys);
    const { sessionsMap } = prepareSessionReplays({
      manager: this,
      socket,
      channelsBySessionId,
      control,
      snapshotRequests,
    });
    attachReconnectBaselines(this, socket, reconnectChannelKeys, reconnectTransaction);
    if (snapshotRequests.length) {
      const snapshotResults = await settleSnapshotRequests(snapshotRequests);
      if (socket.__agentProxyReconnectTransaction !== reconnectTransaction) return;
      try {
        const deletedSessionIds = applySnapshotResults(this, sessionsMap, snapshotResults);
        if (deletedSessionIds.size) {
          reconnectTransaction.channelStateBaseline =
            reconnectTransaction.channelStateBaseline.filter(
              (envelope) => !deletedSessionIds.has(text(envelope?.data?.sessionId)),
            );
        }
      } catch (error) {
        socket.__agentProxyReconnectTransaction = null;
        throw error;
      }
    }
    const authoritativeSessions = Array.from(sessionsMap.values());
    logPreparedAuthorityBatches(this, authoritativeSessions, channelsBySessionId);
    publishReconnectTransaction({
      manager: this,
      socket,
      transaction: reconnectTransaction,
      control,
      sessions: authoritativeSessions,
    });
  }

  _resolveReconnectChannelKeys(socket, currentSessionId) {
    const currentSocketChannelKeys = Array.from(
      socket?.__agentProxyChannelKeys instanceof Set ? socket.__agentProxyChannelKeys : [],
    ).filter(Boolean);
    if (currentSocketChannelKeys.length) {
      return currentSocketChannelKeys;
    }
    const requesterApiKey = text(socket?.__agentProxyApiKey);
    const requesterUserId = text(socket?.__agentProxyUserId);
    const resolvedChannelKeys = [];
    for (const [channelKey, channel] of this.channelStore.entries()) {
      if (!isReconnectChannelCandidate(this, channelKey, channel, currentSessionId)) continue;
      if (!this.hasChannelPermission(channel, requesterApiKey, requesterUserId)) continue;
      resolvedChannelKeys.push(channelKey);
    }
    return resolvedChannelKeys;
  }
}

export const reconnectMethods = Object.getOwnPropertyDescriptors(ReconnectMethods.prototype);
delete reconnectMethods.constructor;
