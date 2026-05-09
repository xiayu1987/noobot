/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { config } from "./config.js";
import {
  normalizeApiKey,
  createChannelKey,
  nowMs,
  isTerminalStatus,
  buildFingerprint,
  buildUpstreamUrl,
} from "./utils.js";

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
      status: "idle",
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
      cleanupAfterMs: 0,
      upstreamClosed: false,
      ownerApiKey: "",
      ownerUserId: "",
      _errorHandled: false,
    };
    if (startPayload && typeof startPayload === "object") {
      nextChannel.startPayload = { ...startPayload };
    }
    this.channelStore.set(normalizedChannelKey, nextChannel);
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
      event: String(eventName || "message").trim() || "message",
      data: data && typeof data === "object" ? data : {},
    };
    channel.eventLog.push(envelope);
    if (channel.eventLog.length > config.maxChannelEvents) {
      channel.eventLog = channel.eventLog.slice(-config.maxChannelEvents);
    }
    if (String(envelope.event || "") === "interaction_request") {
      const requestId = String(envelope?.data?.requestId || "").trim();
      if (requestId) {
        this.requestChannelMap.set(requestId, { channelKey: channel.key, createdAtMs: nowMs() });
      }
    }
    return envelope;
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
      role: String(role || "").trim() || "user",
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
    this.sendSocketEvent(targetSocket, {
      event: "error",
      data: {
        error: String(errorMessage || "agentProxy error").trim() || "agentProxy error",
      },
    });
  }

  // ---- Upstream Connection ----

  closeUpstreamChannel(channel, closeCode = 1000, reasonText = "closed") {
    if (!channel?.upstreamSocket) return;
    try {
      channel.upstreamSocket.close(closeCode, reasonText);
    } catch {
      // ignore close errors
    }
    channel.upstreamSocket = null;
  }

  markChannelTerminal(channel, terminalStatus = "done") {
    if (!channel) return;
    channel.status = String(terminalStatus || "done").trim();
    channel.updatedAtMs = nowMs();
    channel.cleanupAfterMs = nowMs() + config.channelRetentionMs;
  }

  connectUpstreamChannel(channel, apiKey = "", locale = "") {
    if (!channel || channel.upstreamSocket) return;
    channel._errorHandled = false;
    const upstreamUrl = buildUpstreamUrl(config.upstreamWsUrl, apiKey);
    if (!upstreamUrl) {
      const errorEnvelope = this.pushChannelEvent(channel, "error", {
        error: "agentProxy upstream url is empty",
      });
      this.markChannelTerminal(channel, "error");
      this.broadcastChannelEvent(channel, errorEnvelope);
      return;
    }
    const upstreamSocket = new this.WebSocket(upstreamUrl);
    channel.upstreamSocket = upstreamSocket;
    channel.status = "connecting";
    channel.apiKey = String(apiKey || "").trim();
    channel.locale = String(locale || "").trim();
    channel.updatedAtMs = nowMs();

    upstreamSocket.on("open", () => {
      channel.status = "running";
      channel.updatedAtMs = nowMs();
      const payloadToSend =
        channel.startPayload && typeof channel.startPayload === "object"
          ? { ...channel.startPayload }
          : null;
      if (!payloadToSend) return;
      try {
        upstreamSocket.send(JSON.stringify(payloadToSend));
      } catch (error) {
        const errorEnvelope = this.pushChannelEvent(channel, "error", {
          error: String(error?.message || "agentProxy failed to send payload"),
        });
        this.markChannelTerminal(channel, "error");
        this.broadcastChannelEvent(channel, errorEnvelope);
        this.closeUpstreamChannel(channel, 1011, "send_failed");
      }
    });

    upstreamSocket.on("message", (rawData) => {
      try {
        const parsed = JSON.parse(String(rawData || "{}"));
        const eventName = String(parsed?.event || "message").trim() || "message";
        const eventData =
          parsed?.data && typeof parsed.data === "object" ? parsed.data : {};
        const eventEnvelope = this.pushChannelEvent(channel, eventName, eventData);
        this.broadcastChannelEvent(channel, eventEnvelope);
        if (eventName === "done") {
          this.markChannelTerminal(channel, "done");
        } else if (eventName === "stopped") {
          this.markChannelTerminal(channel, "stopped");
        } else if (eventName === "error") {
          this.markChannelTerminal(channel, "error");
        } else {
          channel.status = "running";
        }
      } catch (error) {
        const errorEnvelope = this.pushChannelEvent(channel, "error", {
          error: String(error?.message || "agentProxy invalid upstream event"),
        });
        this.markChannelTerminal(channel, "error");
        this.broadcastChannelEvent(channel, errorEnvelope);
        this.closeUpstreamChannel(channel, 1011, "invalid_upstream_event");
      }
    });

    upstreamSocket.on("close", () => {
      channel.upstreamSocket = null;
      channel.upstreamClosed = true;
      if (!isTerminalStatus(channel.status)) {
        this.markChannelTerminal(channel, "stopped");
        const stoppedEnvelope = this.pushChannelEvent(channel, "stopped", {
          message: "upstream socket closed",
        });
        this.broadcastChannelEvent(channel, stoppedEnvelope);
      }
    });

    upstreamSocket.on("error", (error) => {
      if (channel._errorHandled) return;
      channel._errorHandled = true;
      const errorEnvelope = this.pushChannelEvent(channel, "error", {
        error: String(error?.message || "upstream websocket error"),
      });
      this.markChannelTerminal(channel, "error");
      this.broadcastChannelEvent(channel, errorEnvelope);
    });
  }

  // ---- Channel Resolution ----

  resolveChannelFromSocketMessage(socket, payload = {}) {
    const action = String(payload?.action || "").trim().toLowerCase();
    if (action === "interaction_response") {
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
      return true;
    } catch {
      return false;
    }
  }

  // ---- Start / Join ----

  startOrJoinChannel({ socket, payload, connectionApiKey, connectionLocale }) {
    const normalizedConnectionApiKey = normalizeApiKey(connectionApiKey);
    if (!normalizedConnectionApiKey) {
      this.sendSocketError(socket, "agentProxy requires apikey");
      return;
    }
    const userId = String(payload?.userId || "").trim();
    const sessionId = String(payload?.sessionId || "").trim();
    if (!userId || !sessionId) {
      this.sendSocketError(socket, "agentProxy requires userId and sessionId");
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
      this.sendSocketError(
        socket,
        `agentProxy permission denied for action: start_or_join`,
      );
      return;
    }

    this.attachSubscriber(channel, socket);
    if (config.replayOnReconnect) {
      const subscriberSequenceByChannel = socket.__agentProxyLastSequenceByChannel || {};
      const lastKnownSequence = Number(subscriberSequenceByChannel[channel.key] || 0);
      this.replayChannelEvents(channel, socket, lastKnownSequence);
    } else {
      this.syncSocketToChannelTail(channel, socket);
    }

    const nextPayloadFingerprint = buildFingerprint(payload);
    const sameAsLastPayload = channel.startFingerprint === nextPayloadFingerprint;
    const keepExistingRun =
      channel.status === "running" || channel.status === "connecting";
    if (keepExistingRun) return;
    if (isTerminalStatus(channel.status) && sameAsLastPayload) return;

    channel.startPayload = { ...payload };
    channel.startFingerprint = nextPayloadFingerprint;
    channel.eventLog = [];
    channel.eventSequence = 0;
    channel.cleanupAfterMs = 0;
    channel.upstreamClosed = false;
    channel._errorHandled = false;
    this.closeUpstreamChannel(channel, 1000, "restart");
    this.connectUpstreamChannel(channel, normalizedConnectionApiKey, String(connectionLocale || "").trim());
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
        channel.status === "idle" &&
        !channel.subscribers.size &&
        currentMs - Number(channel.updatedAtMs || currentMs) > config.channelRetentionMs;
      if (!canCleanupTerminal && !canCleanupIdle) continue;
      this.closeUpstreamChannel(channel, 1000, "cleanup");
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
      if (!createdAtMs || currentMs - createdAtMs > config.requestIdTtlMs) {
        this.requestChannelMap.delete(requestId);
      }
    }
  }
}
