import { config } from "../config.js";
import {
  CHANNEL_EVENT,
  CHANNEL_STATUS,
  CLIENT_ROLE,
  CONVERSATION_SCOPE_KEY,
  CONVERSATION_STATE,
  CONVERSATION_SOURCE_EVENT,
} from "../constants.js";
import { normalizeApiKey, nowMs } from "../utils.js";

class ChannelStoreMethods {
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
  this.logSessionEvent(channel, {
    category: "message",
    event: "agentProxy.channel.event",
    data: {
      channelKey: channel.key,
      event: envelope.event,
      sequence: envelope.sequence,
      sessionId: envelope.data?.sessionId,
      dialogProcessId: envelope.data?.dialogProcessId,
      turnScopeId: envelope.data?.turnScopeId,
      requestId: envelope.data?.requestId,
      hasContent: Boolean(envelope.data?.content || envelope.data?.text),
    },
  });
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
    turnScopeId = "",
    createdAtMs = 0,
    requestId = "",
  } = {},
) {
  if (!channel) return null;
  const normalizedState = String(state || "").trim();
  if (!normalizedState) return null;
  const normalizedDialogProcessId = String(dialogProcessId || "").trim();
  const stateKey = normalizedDialogProcessId || CONVERSATION_SCOPE_KEY;
  const normalizedSessionId =
    String(sessionId || "").trim() || this._extractSessionIdFromChannelKey(channel.key);
  const normalizedTurnScopeId = String(turnScopeId || "").trim();
  const previousStateItem = channel.conversationStateByDialogProcessId.get(stateKey) || null;
  if (
    previousStateItem &&
    previousStateItem.state === normalizedState &&
    Number(previousStateItem.seq || 0) === Number(seq || 0) &&
    (!normalizedTurnScopeId || String(previousStateItem?.turnScopeId || "").trim() === normalizedTurnScopeId)
  ) {
    return previousStateItem;
  }
  const nextCreatedAtMs = Number(
    createdAtMs || previousStateItem?.createdAtMs || previousStateItem?.updatedAtMs || nowMs(),
  );
  const stateItem = {
    sessionId: normalizedSessionId,
    dialogProcessId: normalizedDialogProcessId,
    turnScopeId: normalizedTurnScopeId || String(previousStateItem?.turnScopeId || "").trim(),
    state: normalizedState,
    sourceEvent: String(sourceEvent || "").trim(),
    seq: Number(seq || 0),
    createdAtMs: Number.isFinite(nextCreatedAtMs) ? nextCreatedAtMs : nowMs(),
    updatedAtMs: nowMs(),
    requestId: String(requestId || "").trim(),
  };
  channel.conversationStateByDialogProcessId.set(stateKey, stateItem);
  this.logSessionEvent(channel, {
    category: "state",
    event: "agentProxy.conversation.state",
    sessionId: stateItem.sessionId,
    dialogProcessId: stateItem.dialogProcessId,
    turnScopeId: stateItem.turnScopeId,
    data: {
      channelKey: channel.key,
      state: stateItem.state,
      sourceEvent: stateItem.sourceEvent,
      seq: stateItem.seq,
      requestId: stateItem.requestId,
    },
  });
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
  const turnScopeId = String(
    eventData?.turnScopeId || channel?.startPayload?.turnScopeId || "",
  ).trim();
  const sessionId = String(eventData?.sessionId || "").trim();
  const seq = Number(eventData?.seq || envelope?.sequence || 0);
  const createdAtMs = Number(
    eventData?.createdAtMs ||
      eventData?.timestamp ||
      (eventData?.createdAt ? Date.parse(eventData.createdAt) : 0) ||
      0,
  );
  let nextState = "";
  if (eventName === CHANNEL_EVENT.THINKING || eventName === CHANNEL_EVENT.DELTA) {
    nextState = CONVERSATION_STATE.SENDING;
  } else if (eventName === CHANNEL_EVENT.INTERACTION_REQUEST) {
    nextState = CONVERSATION_STATE.INTERACTION_PENDING;
  } else if (eventName === CHANNEL_EVENT.DONE) {
    nextState = CONVERSATION_STATE.COMPLETED;
  } else if (eventName === CHANNEL_EVENT.USER_STOPPED) {
    nextState = CONVERSATION_STATE.USER_STOPPED;
  } else if (eventName === CHANNEL_EVENT.ERROR) {
    nextState = CONVERSATION_STATE.ERROR;
  }
  if (!nextState) return;
  this.updateConversationState(channel, {
    dialogProcessId,
    turnScopeId,
    state: nextState,
    sourceEvent: eventName,
    seq,
    createdAtMs,
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
}

export const channelstoreMethods = Object.getOwnPropertyDescriptors(ChannelStoreMethods.prototype);
delete channelstoreMethods.constructor;
