/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { computed, ref } from "vue";
import { vi } from "vitest";
import { useReconnectReplay } from "../../../../../src/composables/chat/useReconnectReplay";
import { RoleEnum } from "../../../../../src/shared/constants/chatConstants";
import {
  applyTurnRuntimeEvent,
  createTurnRuntimeRegistryState,
  resolveSessionTurnRuntime,
  selectSessionTurnRuntime,
} from "../../../../../src/composables/chat/sessionRunStateMachine/turnRuntimeRegistry";

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

export function createFixture({ activeId = "s-1", processStore = null } = {}) {
  const s1 = createSession("s-1");
  const s2 = createSession("s-2");
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
    events.map((event) => applyTurnRuntimeEvent(turnRuntimeRegistry.value, event)),
  );

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
    clearStopRequested: vi.fn(),
    reconnect: vi.fn(async () => {}),
  };

  const appendMessage = vi.fn((role, content = "") => {
    const msg = { role, content, pending: false, statusLabel: "", realtimeLogs: [] };
    activeSession.value.messages.push(msg);
    activeSession.value.rawMessages.push(msg);
    return msg;
  });

  const api = useReconnectReplay({
    sessions,
    activeSession,
    activeSessionId,
    interactionSubmitting,
    chatList,
    chatWebSocketClient,
    appendMessage,
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
    applyTurnRuntimeEvents,
  });

  return {
    api,
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
    },
  };
}
