/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { config } from "./config.js";
import {
  AGENT_PROXY_ERROR,
  CHANNEL_EVENT,
  CHANNEL_STATUS,
  CLIENT_ROLE,
  CONVERSATION_SCOPE_KEY,
  CONVERSATION_STATE,
  CONVERSATION_SOURCE_EVENT,
  RECONNECT_SUGGESTION,
  UPSTREAM_CLOSE_REASON,
  WS_ACTION,
} from "./constants.js";
import {
  normalizeApiKey,
  createChannelKey,
  nowMs,
  isTerminalStatus,
  buildFingerprint,
  buildUpstreamUrl,
} from "./utils.js";
import { localizeAgentProxyMessage } from "noobot-i18n/agent-proxy";

export class ChannelManager {
  constructor(WebSocket) {
    this.WebSocket = WebSocket;
    this.channelStore = new Map();
    this.requestChannelMap = new Map();
    this.apiKeyIdentityStore = new Map();
  }

  // ---- Channel CRUD ----

  ensureChannel(channelKey = "", startPayload = {}) {
    const normalizedChannelKey = String(channelKey || "").trim();
    if (!normalizedChannelKey) return null;
    const existingChannel = this.channelStore.get(normalizedChannelKey);
    if (existingChannel) return existingChannel;
    const nextChannel = {
      key: normalizedChannelKey,
      status: CHANNEL_STATUS.IDLE,
      createdAtMs: nowMs(),
      updatedAtMs: nowMs(),
      subscribers: new Set(),
      upstreamSocket: null,
      apiKey: "",
      locale: "",
      startPayload: null,
      startFingerprint: "",
      eventSequence: 0,
      eventLog: [],
      pendingInteractionRequests: new Map(),
      cleanupAfterMs: 0,
      upstreamClosed: false,
      ownerApiKey: "",
      ownerUserId: "",
      _errorHandled: false,
      conversationStateByDialogProcessId: new Map(),
    };
    if (startPayload && typeof startPayload === "object") {
      nextChannel.startPayload = { ...startPayload };
    }
    this.channelStore.set(normalizedChannelKey, nextChannel);
    this.updateConversationState(nextChannel, {
      dialogProcessId: "",
      state: CONVERSATION_STATE.NO_CONVERSATION,
      sourceEvent: CONVERSATION_SOURCE_EVENT.INIT,
      seq: 0,
      broadcast: false,
    });
    return nextChannel;
  }

  getChannel(channelKey) {
    return this.channelStore.get(String(channelKey || "").trim()) || null;
  }

  hasChannel(channelKey) {
    return this.channelStore.has(String(channelKey || "").trim());
  }

  deleteChannel(channelKey) {
    this.channelStore.delete(String(channelKey || "").trim());
  }

  get channelCount() {
    return this.channelStore.size;
  }

  // ---- Event Log ----

  pushChannelEvent(channel, eventName = "", data = {}) {
    if (!channel) return null;
    channel.eventSequence += 1;
    channel.updatedAtMs = nowMs();
    const envelope = {
      sequence: channel.eventSequence,
      event: String(eventName || CHANNEL_EVENT.MESSAGE).trim() || CHANNEL_EVENT.MESSAGE,
      data: data && typeof data === "object" ? data : {},
    };
    channel.eventLog.push(envelope);
    if (channel.eventLog.length > config.maxChannelEvents) {
      channel.eventLog = channel.eventLog.slice(-config.maxChannelEvents);
    }
    if (String(envelope.event || "") === CHANNEL_EVENT.INTERACTION_REQUEST) {
      const requestId = String(envelope?.data?.requestId || "").trim();
      if (requestId) {
        this.requestChannelMap.set(requestId, { channelKey: channel.key, createdAtMs: nowMs() });
        channel.pendingInteractionRequests.set(requestId, envelope);
      }
    }
    this._applyConversationStateFromEnvelope(channel, envelope);
    return envelope;
  }

  updateConversationState(
    channel,
    {
      dialogProcessId = "",
      state = "",
      sourceEvent = "",
      seq = 0,
      broadcast = true,
      sessionId = "",
    } = {},
  ) {
    if (!channel) return null;
    const normalizedState = String(state || "").trim();
    if (!normalizedState) return null;
    const normalizedDialogProcessId = String(dialogProcessId || "").trim();
    const stateKey = normalizedDialogProcessId || CONVERSATION_SCOPE_KEY;
    const normalizedSessionId =
      String(sessionId || "").trim() || this._extractSessionIdFromChannelKey(channel.key);
    const previousStateItem = channel.conversationStateByDialogProcessId.get(stateKey) || null;
    if (
      previousStateItem &&
      previousStateItem.state === normalizedState &&
      Number(previousStateItem.seq || 0) === Number(seq || 0)
    ) {
      return previousStateItem;
    }
    const stateItem = {
      sessionId: normalizedSessionId,
      dialogProcessId: normalizedDialogProcessId,
      state: normalizedState,
      sourceEvent: String(sourceEvent || "").trim(),
      seq: Number(seq || 0),
      updatedAtMs: nowMs(),
    };
    channel.conversationStateByDialogProcessId.set(stateKey, stateItem);
    if (broadcast) {
      this.broadcastChannelState(channel, stateItem);
    }
    return stateItem;
  }

  _applyConversationStateFromEnvelope(channel, envelope = {}) {
    if (!channel || !envelope) return;
    const eventName = String(envelope?.event || "").trim();
    const eventData = envelope?.data || {};
    const dialogProcessId = String(eventData?.dialogProcessId || "").trim();
    const sessionId = String(eventData?.sessionId || "").trim();
    const seq = Number(eventData?.seq || envelope?.sequence || 0);
    let nextState = "";
    if (eventName === CHANNEL_EVENT.THINKING || eventName === CHANNEL_EVENT.DELTA) {
      nextState = CONVERSATION_STATE.SENDING;
    } else if (eventName === CHANNEL_EVENT.INTERACTION_REQUEST) {
      nextState = CONVERSATION_STATE.INTERACTION_PENDING;
    } else if (eventName === CHANNEL_EVENT.DONE) {
      nextState = CONVERSATION_STATE.COMPLETED;
    } else if (eventName === CHANNEL_EVENT.STOPPED) {
      nextState = CONVERSATION_STATE.STOPPED;
    } else if (eventName === CHANNEL_EVENT.ERROR) {
      nextState = CONVERSATION_STATE.ERROR;
    }
    if (!nextState) return;
    this.updateConversationState(channel, {
      dialogProcessId,
      state: nextState,
      sourceEvent: eventName,
      seq,
      sessionId,
    });
  }

  // ---- Request ID Mapping ----

  getChannelByRequestId(requestId) {
    const rid = String(requestId || "").trim();
    if (!rid || !this.requestChannelMap.has(rid)) return null;
    const mappedEntry = this.requestChannelMap.get(rid);
    const mappedChannelKey = typeof mappedEntry === "object" ? mappedEntry.channelKey : mappedEntry;
    return this.channelStore.get(mappedChannelKey) || null;
  }

  // ---- API Key Identity ----

  saveApiKeyIdentity({ apiKey = "", userId = "", role = "" } = {}) {
    const normalizedApiKey = normalizeApiKey(apiKey);
    const normalizedUserId = String(userId || "").trim();
    if (!normalizedApiKey || !normalizedUserId) return;
    this.apiKeyIdentityStore.set(normalizedApiKey, {
      apiKey: normalizedApiKey,
      userId: normalizedUserId,
      role: String(role || "").trim() || CLIENT_ROLE.USER,
      updatedAtMs: nowMs(),
    });
  }

  resolveApiKeyIdentity(apiKey = "") {
    const normalizedApiKey = normalizeApiKey(apiKey);
    if (!normalizedApiKey || !this.apiKeyIdentityStore.has(normalizedApiKey)) return null;
    return this.apiKeyIdentityStore.get(normalizedApiKey) || null;
  }

  // ---- Permissions ----

  hasChannelPermission(channel, apiKey = "", requesterUserId = "") {
    if (!channel) return false;
    const normalizedApiKey = normalizeApiKey(apiKey);
    const ownerApiKey = normalizeApiKey(channel?.ownerApiKey || "");
    const normalizedRequesterUserId = String(requesterUserId || "").trim();
    const ownerUserId = String(channel?.ownerUserId || "").trim();
    if (ownerUserId && normalizedRequesterUserId && ownerUserId === normalizedRequesterUserId) {
      return true;
    }
    if (!ownerApiKey) return Boolean(normalizedApiKey);
    return Boolean(normalizedApiKey && normalizedApiKey === ownerApiKey);
  }

  // ---- Subscriber Management ----

  attachSubscriber(channel, socket) {
    if (!channel || !socket) return;
    channel.subscribers.add(socket);
    socket.__agentProxyChannelKeys = socket.__agentProxyChannelKeys || new Set();
    socket.__agentProxyChannelKeys.add(channel.key);
    socket.__agentProxyActiveChannelKey = channel.key;
    this.sendChannelStateSnapshot(channel, socket);
  }

  detachSocketFromAllChannels(socket) {
    if (!socket) return;
    const connectedChannelKeys = socket.__agentProxyChannelKeys || new Set();
    for (const channelKey of connectedChannelKeys) {
      const channel = this.channelStore.get(channelKey);
      if (!channel) continue;
      channel.subscribers.delete(socket);
      channel.updatedAtMs = nowMs();
      if (!channel.subscribers.size && isTerminalStatus(channel.status)) {
        channel.cleanupAfterMs = nowMs() + config.channelRetentionMs;
      }
    }
    socket.__agentProxyChannelKeys = new Set();
    socket.__agentProxyActiveChannelKey = "";
    socket.__agentProxyLastSequenceByChannel = {};
  }

  // ---- Replay & Broadcast ----

  replayChannelEvents(channel, targetSocket, lastSequence = 0) {
    if (!channel || !targetSocket) return;
    const expectedSequence = Math.max(0, Number(lastSequence || 0));
    const replayEvents = channel.eventLog.filter(
      (eventEnvelope) => Number(eventEnvelope?.sequence || 0) > expectedSequence,
    );
    for (const eventEnvelope of replayEvents) {
      this.sendSocketEvent(targetSocket, eventEnvelope);
    }
    targetSocket.__agentProxyLastSequenceByChannel =
      targetSocket.__agentProxyLastSequenceByChannel || {};
    targetSocket.__agentProxyLastSequenceByChannel[channel.key] = channel.eventSequence;
  }

  syncSocketToChannelTail(channel, targetSocket) {
    if (!channel || !targetSocket) return;
    targetSocket.__agentProxyLastSequenceByChannel =
      targetSocket.__agentProxyLastSequenceByChannel || {};
    targetSocket.__agentProxyLastSequenceByChannel[channel.key] = Number(
      channel?.eventSequence || 0,
    );
  }

  broadcastChannelEvent(channel, envelope) {
    if (!channel || !envelope) return;
    for (const subscriberSocket of channel.subscribers) {
      this.sendSocketEvent(subscriberSocket, envelope);
      subscriberSocket.__agentProxyLastSequenceByChannel =
        subscriberSocket.__agentProxyLastSequenceByChannel || {};
      subscriberSocket.__agentProxyLastSequenceByChannel[channel.key] = Number(
        envelope?.sequence || 0,
      );
    }
  }

  broadcastChannelState(channel, stateItem = {}) {
    if (!channel || !stateItem) return;
    const pendingInteraction = this._findLatestPendingInteractionByDialogProcessId(
      channel,
      String(stateItem?.dialogProcessId || "").trim(),
    );
    this.broadcastChannelEvent(channel, {
      sequence: Number(channel?.eventSequence || 0),
      event: CHANNEL_EVENT.CHANNEL_STATE,
      data: {
        sessionId: String(stateItem?.sessionId || ""),
        dialogProcessId: String(stateItem?.dialogProcessId || ""),
        state: String(stateItem?.state || ""),
        sourceEvent: String(stateItem?.sourceEvent || ""),
        seq: Number(stateItem?.seq || 0),
        updatedAtMs: Number(stateItem?.updatedAtMs || nowMs()),
        ...(pendingInteraction ? { pendingInteraction } : {}),
      },
    });
  }

  sendChannelStateSnapshot(channel, targetSocket) {
    if (!channel || !targetSocket) return;
    const stateList = Array.from(channel.conversationStateByDialogProcessId.values()).sort(
      (left, right) =>
        Number(left?.updatedAtMs || 0) - Number(right?.updatedAtMs || 0),
    );
    for (const stateItem of stateList) {
      const pendingInteraction = this._findLatestPendingInteractionByDialogProcessId(
        channel,
        String(stateItem?.dialogProcessId || "").trim(),
      );
      this.sendSocketEvent(targetSocket, {
        event: CHANNEL_EVENT.CHANNEL_STATE,
        data: {
          sessionId: String(stateItem?.sessionId || ""),
          dialogProcessId: String(stateItem?.dialogProcessId || ""),
          state: String(stateItem?.state || ""),
          sourceEvent: String(stateItem?.sourceEvent || ""),
          seq: Number(stateItem?.seq || 0),
          updatedAtMs: Number(stateItem?.updatedAtMs || 0),
          ...(pendingInteraction ? { pendingInteraction } : {}),
        },
      });
    }
  }

  _findLatestPendingInteractionByDialogProcessId(channel, dialogProcessId = "") {
    if (!channel?.pendingInteractionRequests?.size) return null;
    const normalizedDpId = String(dialogProcessId || "").trim();
    if (!normalizedDpId) return null;
    let latestEnvelope = null;
    let latestSequence = 0;
    for (const envelope of channel.pendingInteractionRequests.values()) {
      const envelopeDpId = String(envelope?.data?.dialogProcessId || "").trim();
      if (!envelopeDpId || envelopeDpId !== normalizedDpId) continue;
      const sequence = Number(envelope?.data?.seq || envelope?.sequence || 0);
      if (!latestEnvelope || sequence >= latestSequence) {
        latestEnvelope = envelope;
        latestSequence = sequence;
      }
    }
    if (!latestEnvelope?.data || typeof latestEnvelope.data !== "object") return null;
    return {
      ...latestEnvelope.data,
    };
  }

  sendSocketEvent(targetSocket, envelope) {
    if (!targetSocket || targetSocket.readyState !== this.WebSocket.OPEN || !envelope) return;
    try {
      targetSocket.send(
        JSON.stringify({
          event: envelope.event,
          data: envelope.data,
        }),
      );
    } catch {
      // ignore send errors
    }
  }

  sendSocketError(targetSocket, errorMessage = "") {
    const localizedError = localizeAgentProxyMessage(
      String(errorMessage || ""),
      String(targetSocket?.__agentProxyLocale || "").trim(),
    );
    this.sendSocketEvent(targetSocket, {
      event: CHANNEL_EVENT.ERROR,
      data: {
        error: String(localizedError || AGENT_PROXY_ERROR.DEFAULT).trim() ||
          AGENT_PROXY_ERROR.DEFAULT,
      },
    });
  }

  // ---- Upstream Connection ----

  closeUpstreamChannel(
    channel,
    closeCode = 1000,
    reasonText = UPSTREAM_CLOSE_REASON.CLOSED,
  ) {
    if (!channel?.upstreamSocket) return;
    try {
      channel.upstreamSocket.close(closeCode, reasonText);
    } catch {
      // ignore close errors
    }
    channel.upstreamSocket = null;
  }

  markChannelTerminal(channel, terminalStatus = CHANNEL_STATUS.DONE) {
    if (!channel) return;
    channel.status = String(terminalStatus || CHANNEL_STATUS.DONE).trim();
    channel.updatedAtMs = nowMs();
    channel.cleanupAfterMs = nowMs() + config.channelRetentionMs;
    channel.pendingInteractionRequests.clear();
  }

  connectUpstreamChannel(channel, apiKey = "", locale = "") {
    if (!channel || channel.upstreamSocket) return;
    channel._errorHandled = false;
    const upstreamUrl = buildUpstreamUrl(config.upstreamWsUrl, apiKey);
    if (!upstreamUrl) {
      const errorEnvelope = this.pushChannelEvent(channel, CHANNEL_EVENT.ERROR, {
        error: AGENT_PROXY_ERROR.UPSTREAM_URL_EMPTY,
      });
      this.markChannelTerminal(channel, CHANNEL_STATUS.ERROR);
      this.broadcastChannelEvent(channel, errorEnvelope);
      return;
    }
    const upstreamSocket = new this.WebSocket(upstreamUrl);
    channel.upstreamSocket = upstreamSocket;
    channel.status = CHANNEL_STATUS.CONNECTING;
    channel.apiKey = String(apiKey || "").trim();
    channel.locale = String(locale || "").trim();
    channel.updatedAtMs = nowMs();

    upstreamSocket.on("open", () => {
      channel.status = CHANNEL_STATUS.RUNNING;
      channel.updatedAtMs = nowMs();
      const payloadToSend =
        channel.startPayload && typeof channel.startPayload === "object"
          ? { ...channel.startPayload }
          : null;
      if (!payloadToSend) return;
      try {
        upstreamSocket.send(JSON.stringify(payloadToSend));
      } catch (error) {
        const errorEnvelope = this.pushChannelEvent(channel, CHANNEL_EVENT.ERROR, {
          error: String(error?.message || AGENT_PROXY_ERROR.FAILED_TO_SEND_PAYLOAD),
        });
        this.markChannelTerminal(channel, CHANNEL_STATUS.ERROR);
        this.broadcastChannelEvent(channel, errorEnvelope);
        this.closeUpstreamChannel(channel, 1011, UPSTREAM_CLOSE_REASON.SEND_FAILED);
      }
    });

    upstreamSocket.on(CHANNEL_EVENT.MESSAGE, (rawData) => {
      try {
        const parsed = JSON.parse(String(rawData || "{}"));
        const eventName = String(parsed?.event || CHANNEL_EVENT.MESSAGE).trim() || CHANNEL_EVENT.MESSAGE;
        const eventData =
          parsed?.data && typeof parsed.data === "object" ? parsed.data : {};
        const eventEnvelope = this.pushChannelEvent(channel, eventName, eventData);
        this.broadcastChannelEvent(channel, eventEnvelope);
        if (eventName === CHANNEL_EVENT.DONE) {
          this.markChannelTerminal(channel, CHANNEL_STATUS.DONE);
        } else if (eventName === CHANNEL_EVENT.STOPPED) {
          this.markChannelTerminal(channel, CHANNEL_STATUS.STOPPED);
        } else if (eventName === CHANNEL_EVENT.ERROR) {
          this.markChannelTerminal(channel, CHANNEL_STATUS.ERROR);
        } else {
          channel.status = CHANNEL_STATUS.RUNNING;
        }
      } catch (error) {
        const errorEnvelope = this.pushChannelEvent(channel, CHANNEL_EVENT.ERROR, {
          error: String(error?.message || AGENT_PROXY_ERROR.INVALID_UPSTREAM_EVENT),
        });
        this.markChannelTerminal(channel, CHANNEL_STATUS.ERROR);
        this.broadcastChannelEvent(channel, errorEnvelope);
        this.closeUpstreamChannel(
          channel,
          1011,
          UPSTREAM_CLOSE_REASON.INVALID_UPSTREAM_EVENT,
        );
      }
    });

    upstreamSocket.on("close", (closeCode, closeReasonBuffer) => {
      channel.upstreamSocket = null;
      channel.upstreamClosed = true;
      const closeReason =
        typeof closeReasonBuffer === "string"
          ? closeReasonBuffer
          : Buffer.isBuffer(closeReasonBuffer)
            ? closeReasonBuffer.toString("utf8")
            : "";
      const normalizedCloseCode = Number(closeCode || 0) || 0;
      if (!isTerminalStatus(channel.status)) {
        this.markChannelTerminal(channel, CHANNEL_STATUS.STOPPED);
        const stoppedEnvelope = this.pushChannelEvent(channel, CHANNEL_EVENT.STOPPED, {
          message: "upstream socket closed",
          upstreamCloseCode: normalizedCloseCode,
          upstreamCloseReason: closeReason || "upstream socket closed",
        });
        this.broadcastChannelEvent(channel, stoppedEnvelope);
      }
    });

    upstreamSocket.on(CHANNEL_EVENT.ERROR, (error) => {
      if (channel._errorHandled) return;
      channel._errorHandled = true;
      const errorEnvelope = this.pushChannelEvent(channel, CHANNEL_EVENT.ERROR, {
        error: String(error?.message || "upstream websocket error"),
      });
      this.markChannelTerminal(channel, CHANNEL_STATUS.ERROR);
      this.broadcastChannelEvent(channel, errorEnvelope);
    });
  }

  // ---- Channel Resolution ----

  resolveChannelFromSocketMessage(socket, payload = {}) {
    const action = String(payload?.action || "").trim().toLowerCase();
    if (action === WS_ACTION.INTERACTION_RESPONSE) {
      const channel = this.getChannelByRequestId(payload?.requestId);
      if (channel) return channel;
    }
    const explicitChannelKey = String(payload?.channelKey || "").trim();
    if (explicitChannelKey && this.hasChannel(explicitChannelKey)) {
      return this.getChannel(explicitChannelKey);
    }
    const sessionId = String(payload?.sessionId || "").trim();
    const userId = String(payload?.userId || "").trim();
    if (sessionId && userId) {
      const constructedKey = createChannelKey({
        userId,
        sessionId,
        parentSessionId: payload?.parentSessionId,
        parentDialogProcessId: payload?.parentDialogProcessId,
      });
      if (this.hasChannel(constructedKey)) return this.getChannel(constructedKey);
    }
    const activeChannelKey = String(socket?.__agentProxyActiveChannelKey || "").trim();
    if (activeChannelKey && this.hasChannel(activeChannelKey)) {
      return this.getChannel(activeChannelKey);
    }
    return null;
  }

  // ---- Forward ----

  forwardToUpstream(channel, payload = {}) {
    if (!channel?.upstreamSocket || channel.upstreamSocket.readyState !== this.WebSocket.OPEN) {
      return false;
    }
    try {
      channel.upstreamSocket.send(JSON.stringify(payload || {}));
      if (
        String(payload?.action || "").trim().toLowerCase() ===
        WS_ACTION.INTERACTION_RESPONSE
      ) {
        const requestId = String(payload?.requestId || "").trim();
        if (requestId) {
          const requestEnvelope = channel.pendingInteractionRequests.get(requestId) || null;
          channel.pendingInteractionRequests.delete(requestId);
          this.requestChannelMap.delete(requestId);
          this.updateConversationState(channel, {
            dialogProcessId: String(requestEnvelope?.data?.dialogProcessId || "").trim(),
            sessionId: String(requestEnvelope?.data?.sessionId || "").trim(),
            state: CONVERSATION_STATE.SENDING,
            sourceEvent: CONVERSATION_SOURCE_EVENT.INTERACTION_RESPONSE,
            seq: Number(requestEnvelope?.data?.seq || channel?.eventSequence || 0),
          });
        }
      }
      return true;
    } catch {
      return false;
    }
  }

  // ---- Start / Join ----

  startOrJoinChannel({ socket, payload, connectionApiKey, connectionLocale }) {
    const normalizedConnectionApiKey = normalizeApiKey(connectionApiKey);
    if (!normalizedConnectionApiKey) {
      this.sendSocketError(socket, AGENT_PROXY_ERROR.REQUIRES_APIKEY);
      return;
    }
    const userId = String(payload?.userId || "").trim();
    const sessionId = String(payload?.sessionId || "").trim();
    if (!userId || !sessionId) {
      this.sendSocketError(socket, AGENT_PROXY_ERROR.REQUIRES_USERID_SESSIONID);
      return;
    }
    const channelKey = createChannelKey({
      userId,
      sessionId,
      parentSessionId: payload?.parentSessionId,
      parentDialogProcessId: payload?.parentDialogProcessId,
    });
    const channel = this.ensureChannel(channelKey, payload);
    if (!channel) return;
    const identityItem = this.resolveApiKeyIdentity(normalizedConnectionApiKey);
    const requesterUserId =
      String(socket?.__agentProxyUserId || "").trim() ||
      String(identityItem?.userId || "").trim() ||
      String(userId || "").trim();
    if (!channel.ownerApiKey) {
      channel.ownerApiKey = normalizedConnectionApiKey;
    }
    if (!channel.ownerUserId) {
      channel.ownerUserId = requesterUserId;
    }
    if (!this.hasChannelPermission(channel, normalizedConnectionApiKey, requesterUserId)) {
      this.sendSocketError(socket, AGENT_PROXY_ERROR.PERMISSION_DENIED_FOR_ACTION("start_or_join"));
      return;
    }

    const nextPayloadFingerprint = buildFingerprint(payload);
    const keepExistingRun =
      channel.status === CHANNEL_STATUS.RUNNING ||
      channel.status === CHANNEL_STATUS.CONNECTING;
    const shouldStartNewRun = !keepExistingRun;

    this.attachSubscriber(channel, socket);
    this.syncSocketToChannelTail(channel, socket);

    if (keepExistingRun) return;
    if (!shouldStartNewRun) return;

    channel.startPayload = { ...payload };
    channel.startFingerprint = nextPayloadFingerprint;
    channel.eventLog = [];
    channel.eventSequence = 0;
    channel.conversationStateByDialogProcessId = new Map();
    this.updateConversationState(channel, {
      dialogProcessId: "",
      state: CONVERSATION_STATE.NO_CONVERSATION,
      sourceEvent: CONVERSATION_SOURCE_EVENT.RESTART,
      seq: 0,
    });
    channel.cleanupAfterMs = 0;
    channel.upstreamClosed = false;
    channel._errorHandled = false;
    this.closeUpstreamChannel(channel, 1000, UPSTREAM_CLOSE_REASON.RESTART);
    this.connectUpstreamChannel(channel, normalizedConnectionApiKey, String(connectionLocale || "").trim());
  }

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
        const pendingInteraction = this._findLatestPendingInteractionByDialogProcessId(
          channel,
          String(stateItem?.dialogProcessId || "").trim(),
        );
        if (
          !existingStateItem ||
          Number(stateItem?.updatedAtMs || 0) >= Number(existingStateItem?.updatedAtMs || 0)
        ) {
          stateByDialogProcessId.set(stateKey, {
            sessionId: channelSessionId,
            dialogProcessId: String(stateItem?.dialogProcessId || "").trim(),
            state: String(stateItem?.state || "").trim(),
            sourceEvent: String(stateItem?.sourceEvent || "").trim(),
            seq: Number(stateItem?.seq || 0),
            updatedAtMs: Number(stateItem?.updatedAtMs || 0),
            ...(pendingInteraction ? { pendingInteraction } : {}),
          });
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

  // ---- Cleanup ----

  cleanupExpiredChannels() {
    const currentMs = nowMs();
    for (const [channelKey, channel] of this.channelStore.entries()) {
      const canCleanupTerminal =
        isTerminalStatus(channel.status) &&
        Number(channel.cleanupAfterMs || 0) > 0 &&
        currentMs >= Number(channel.cleanupAfterMs || 0);
      const canCleanupIdle =
        channel.status === CHANNEL_STATUS.IDLE &&
        !channel.subscribers.size &&
        currentMs - Number(channel.updatedAtMs || currentMs) > config.channelRetentionMs;
      if (!canCleanupTerminal && !canCleanupIdle) continue;
      this.closeUpstreamChannel(channel, 1000, UPSTREAM_CLOSE_REASON.CLEANUP);
      for (const [requestId, mappedEntry] of this.requestChannelMap.entries()) {
        const mappedChannelKey = typeof mappedEntry === "object" ? mappedEntry.channelKey : mappedEntry;
        if (mappedChannelKey === channelKey) {
          this.requestChannelMap.delete(requestId);
        }
      }
      this.channelStore.delete(channelKey);
    }
    for (const [apiKey, identityItem] of this.apiKeyIdentityStore.entries()) {
      const updatedAtMs = Number(identityItem?.updatedAtMs || 0);
      if (!updatedAtMs || currentMs - updatedAtMs > config.apiKeyRetentionMs) {
        this.apiKeyIdentityStore.delete(apiKey);
      }
    }
    for (const [requestId, mappedEntry] of this.requestChannelMap.entries()) {
      const createdAtMs = typeof mappedEntry === "object" ? Number(mappedEntry.createdAtMs || 0) : 0;
      const mappedChannelKey = typeof mappedEntry === "object" ? mappedEntry.channelKey : mappedEntry;
      const mappedChannel = this.channelStore.get(mappedChannelKey);
      if (mappedChannel?.pendingInteractionRequests?.has(requestId)) {
        continue;
      }
      if (!createdAtMs || currentMs - createdAtMs > config.requestIdTtlMs) {
        this.requestChannelMap.delete(requestId);
      }
    }
  }
}
