/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { computed, ref } from "vue";
import { vi } from "vitest";
import { useReconnectReplay } from "../../../../../src/modules/chat/composables/useReconnectReplay.js";
import { RoleEnum } from "../../../../../src/modules/chat/model/chatConstants.js";
import {
  applyTurnTerminalResolution,
  applyTurnRuntimeEvent,
  applyTurnLifecycleSnapshot,
  createTurnRuntimeRegistryState,
  resolveSessionTurnRuntime,
  selectSessionTurnRuntime,
} from "../../../../../src/modules/chat/runtime/run-state-machine/turnRuntimeRegistry.js";
import { projectTurnRuntimeToMessages } from "../../../../../src/modules/chat/runtime/engine/turnProjectionStore.js";
import { replacePluginExtensions } from "../../../../../src/extensions/extension-registry.js";
import { EXTENSION_POINTS } from "@noobot/plugin-protocol/frontend";
import { activate as activateWorkflowFrontend } from "../../../../../../../plugin/noobot-plugin-workflow/frontend/index.js";

function createSession(id) {
  return {
    id,
    backendSessionId: id,
    title: `session-${id}`,
    loaded: true,
    messages: [],
    rawMessages: [],
    sessionDocs: [],
    messageCount: 0,
    lastMessage: null,
    updatedAt: "",
  };
}

const normalizeIdentityPart = (value, fallback) => String(value || fallback).trim();

export function createCanonicalAssistant({
  messageId,
  presentationMessageId,
  sessionId = "s-1",
  dialogProcessId,
  turnScopeId,
  content = "",
  ...extra
} = {}) {
  const normalizedDialogProcessId = normalizeIdentityPart(dialogProcessId, "dp-1");
  const normalizedMessageId = normalizeIdentityPart(messageId, `message-${normalizedDialogProcessId}`);
  return {
    id: normalizedMessageId,
    messageId: normalizedMessageId,
    presentationMessageId: normalizeIdentityPart(presentationMessageId, normalizedMessageId),
    role: RoleEnum.ASSISTANT,
    sessionId,
    dialogProcessId: normalizedDialogProcessId,
    turnScopeId: normalizeIdentityPart(turnScopeId, `turn-${normalizedDialogProcessId}`),
    content,
    pending: true,
    statusLabel: "",
    realtimeLogs: [],
    ...extra,
  };
}

export function createAuthoritativeMessageEnvelope(eventType, {
  messageId,
  presentationMessageId,
  sessionId = "s-1",
  dialogProcessId,
  turnScopeId,
  seq = 1,
  eventId,
  ...eventData
} = {}) {
  const normalizedDialogProcessId = normalizeIdentityPart(dialogProcessId, "dp-1");
  const normalizedMessageId = normalizeIdentityPart(messageId, `message-${normalizedDialogProcessId}`);
  const normalizedTurnScopeId = normalizeIdentityPart(turnScopeId, `turn-${normalizedDialogProcessId}`);
  const sequence = Number(seq || 0);
  return {
    event: "message_event",
    data: {
      channelKind: "message_event",
      channelVersion: 1,
      route: { scope: "main_session", sessionId },
      sessionId,
      dialogProcessId: normalizedDialogProcessId,
      turnScopeId: normalizedTurnScopeId,
      seq: sequence,
      event: {
        envelopeKind: "noobot.message_event",
        envelopeVersion: 2,
        eventId: normalizeIdentityPart(eventId, `${normalizedMessageId}-${eventType}-${sequence}`),
        eventType,
        sessionId,
        messageId: normalizedMessageId,
        presentationMessageId: normalizeIdentityPart(presentationMessageId, normalizedMessageId),
        sequenceDomain: "message-event",
        sequenceScopeId: normalizedMessageId,
        dialogProcessId: normalizedDialogProcessId,
        turnScopeId: normalizedTurnScopeId,
        sequence,
        timestamp: `2026-01-01T00:00:${String(sequence % 60).padStart(2, "0")}.000Z`,
        ...eventData,
      },
    },
  };
}

export function createFakeProcessStore() {
  const events = [];
  return {
    events,
    applyEventBatch: vi.fn((nextEvents = []) => {
      events.push(...nextEvents);
    }),
    getCompatView: vi.fn(() => {
      const logs = events.map((event) => event?.payload?.log).filter(Boolean);
      return {
        realtimeLogs: logs,
        completedToolLogs: logs,
        executionLogTotal: logs.length,
        lastSequence: Math.max(0, ...events.map((event) => Number(event?.sequence || 0))),
      };
    }),
  };
}

export function createFixture({ activeId = "s-1", processStore = null, currentRun = null } = {}) {
  const workflowContributions = [];
  void activateWorkflowFrontend({
    contributeExtension: (point, contribution) => {
      workflowContributions.push({ point, contribution });
      return true;
    },
    extensionPoints: EXTENSION_POINTS,
    services: {},
  });
  replacePluginExtensions("workflow", workflowContributions);
  const s1 = createSession("s-1");
  const s2 = createSession("s-2");
  if (currentRun) s1.currentRun = { ...currentRun, sessionId: "s-1" };
  const sessions = ref([s1, s2]);
  const activeSessionId = ref(activeId);
  const activeSession = ref(sessions.value.find((s) => s.id === activeId));
  const turnRuntimeRegistry = ref(createTurnRuntimeRegistryState());
  const runtimeView = computed(() => selectSessionTurnRuntime(turnRuntimeRegistry.value, activeSessionId.value));
  const interactionSubmitting = ref(true);
  const pendingInteractionRequest = ref(null);

  const clearPendingInteraction = vi.fn();
  const clearPendingInteractionIfObsolete = vi.fn();
  const setPendingInteractionRequest = vi.fn((request) => {
    pendingInteractionRequest.value = request || null;
  });
  const upsertConnectedConnectorInPanelState = vi.fn();
  const refreshSessionConnectorsAsync = vi.fn();
  const applyCompletedToolLogsToMessages = vi.fn();
  const scrollBottom = vi.fn();
  const notify = vi.fn();
  const applyTurnRuntimeEvents = vi.fn((events = []) =>
    events.map((event) => {
      const result = applyTurnRuntimeEvent(turnRuntimeRegistry.value, event);
      projectTurnRuntimeToMessages({
        sessions,
        turnRuntimeRegistry,
        turn: result?.turn || event,
      });
      return result;
    }),
  );
  const applyAuthoritativeTurnSnapshot = vi.fn((snapshot) => {
    const result = applyTurnLifecycleSnapshot(turnRuntimeRegistry.value, snapshot);
    return result;
  });
  const resolveTurnTerminalState = vi.fn(async () => ({
    applied: false,
    reason: "terminal_unresolved",
  }));
  const dispatchAuthoritativeRunStateEvent = vi.fn((event = {}) => {
    const lifecycleTerminal = event?.type === "backend_turn_lifecycle" && [
      "turn.completed",
      "turn.stop_completed",
      "turn.failed",
    ].includes(String(event?.eventType || "").trim().toLowerCase());
    if (lifecycleTerminal) {
      return resolveTurnTerminalState(event?.sessionId, event?.turnScopeId, {
        commandId: String(event?.commandId || ""),
        sequence: Number(event?.sequence || event?.seq || 0),
        source: "reconnect_replay",
      });
    }
    return applyTurnRuntimeEvents([event])[0];
  });
  const applyWorkflowRuntimeEvent = vi.fn(() => ({ applied: true }));
  const applyTerminalResolution = (response) => {
    const result = applyTurnTerminalResolution(turnRuntimeRegistry.value, response);
    if (result?.applied) {
      turnRuntimeRegistry.value = { ...turnRuntimeRegistry.value };
      projectTurnRuntimeToMessages({
        sessions,
        activeSession,
        turnRuntimeRegistry,
        turn: result.turn,
      });
    }
    return result;
  };

  const chatList = {
    fetchSessions: vi.fn(async () => {}),
    fetchSessionDetail: vi.fn(async (id) => ({
      sessions: [sessions.value.find((sessionItem) => sessionItem.id === id)].filter(Boolean),
    })),
    applySessionDetail: vi.fn((detail = {}) => {
      const sessionDocs = Array.isArray(detail?.sessions) ? detail.sessions : [];
      const nextSession = sessionDocs[0];
      if (!nextSession?.id && !nextSession?.sessionId) return;
      const nextId = nextSession.id || nextSession.sessionId;
      const index = sessions.value.findIndex(
        (sessionItem) => sessionItem.id === nextId || sessionItem.backendSessionId === nextId,
      );
      if (index >= 0) {
        sessions.value[index] = { ...sessions.value[index], ...nextSession };
        if (activeSessionId.value === sessions.value[index].id || activeSessionId.value === nextId) {
          activeSession.value = sessions.value[index];
        }
      }
    }),
    selectSession: vi.fn(async (id) => {
      const found = sessions.value.find((sessionItem) => sessionItem.id === id);
      if (found) {
        activeSessionId.value = id;
        activeSession.value = found;
      }
    }),
  };

  const chatWebSocketClient = {
    reconnect: vi.fn(async () => {}),
  };

  const appendMessage = vi.fn((role, content = "") => {
    const msg = { role, content, pending: false, statusLabel: "", realtimeLogs: [] };
    activeSession.value.messages.push(msg);
    activeSession.value.rawMessages.push(msg);
    return msg;
  });

  const findCanonicalMessageById = vi.fn((sessionId, messageId) => {
    const normalizedSessionId = String(sessionId || "").trim();
    const normalizedMessageId = String(messageId || "").trim();
    if (!normalizedSessionId || !normalizedMessageId) return null;
    const targetSession = sessions.value.find((sessionItem) => [
      sessionItem?.id,
      sessionItem?.sessionId,
      sessionItem?.backendSessionId,
    ].some((candidate) => String(candidate || "").trim() === normalizedSessionId));
    if (!targetSession) return null;
    return targetSession.messages.find((message) =>
      String(message?.messageId || message?.id || "").trim() === normalizedMessageId
    ) || null;
  });

  const upsertCanonicalAssistantMessage = vi.fn((messageId, identity = {}) => {
    const normalizedMessageId = String(messageId || "").trim();
    if (!normalizedMessageId || !activeSession.value) return null;
    const existing = activeSession.value.messages.find((message) =>
      String(message?.messageId || message?.id || "").trim() === normalizedMessageId
    );
    if (existing) return existing;
    const message = createCanonicalAssistant({
      ...identity,
      messageId: normalizedMessageId,
    });
    activeSession.value.messages.push(message);
    activeSession.value.rawMessages.push(message);
    return message;
  });

  const api = useReconnectReplay({
    sessions,
    activeSession,
    activeSessionId,
    interactionSubmitting,
    chatList,
    chatWebSocketClient,
    appendMessage,
    findCanonicalMessageById,
    upsertCanonicalAssistantMessage,
    makeViewMessage: (message) => ({ ...message }),
    foldMessagesForView: (messages) => [...messages],
    applyCompletedToolLogsToMessages,
    sessionTitleFromMessages: () => "session",
    pendingInteractionRequest,
    clearPendingInteraction,
    clearPendingInteractionIfObsolete,
    setPendingInteractionRequest,
    isInteractionRequestHandled: vi.fn(() => false),
    connectorTypeSet: new Set(["email"]),
    upsertConnectedConnectorInPanelState,
    refreshSessionConnectorsAsync,
    classifyRealtimeLog: (item) => item,
    scrollBottom,
    translate: (key) => key,
    notify,
    processStore,
    turnRuntimeRegistry,
    dispatchAuthoritativeRunStateEvent,
    applyWorkflowRuntimeEvent,
    applyTurnLifecycleSnapshot: applyAuthoritativeTurnSnapshot,
    resolveTurnTerminalState,
  });

  const applyCanonicalMessageEvent = (eventType, data = {}) => {
    const envelope = createAuthoritativeMessageEnvelope(eventType, data);
    return api.applyReconnectEvent(envelope.event, envelope.data);
  };

  return {
    api: { ...api, applyCanonicalMessageEvent },
    refs: {
      sessions,
      activeSession,
      activeSessionId,
      turnRuntimeRegistry,
      sending: computed(() => runtimeView.value.sending),
      canStop: computed(() => runtimeView.value.canStop),
      activeTurnRuntime: computed(() => {
        return resolveSessionTurnRuntime(turnRuntimeRegistry.value, activeSessionId.value);
      }),
      interactionSubmitting,
      pendingInteractionRequest,
    },
    mocks: {
      appendMessage,
      findCanonicalMessageById,
      clearPendingInteraction,
      clearPendingInteractionIfObsolete,
      setPendingInteractionRequest,
      upsertConnectedConnectorInPanelState,
      refreshSessionConnectorsAsync,
      applyCompletedToolLogsToMessages,
      scrollBottom,
      notify,
      chatList,
      chatWebSocketClient,
      applyTurnRuntimeEvents,
      dispatchAuthoritativeRunStateEvent,
      applyTurnLifecycleSnapshot: applyAuthoritativeTurnSnapshot,
      applyWorkflowRuntimeEvent,
      resolveTurnTerminalState,
      applyTerminalResolution,
    },
  };
}
