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
  createTurnRuntimeRegistryState,
  resolveSessionTurnRuntime,
  selectSessionTurnRuntime,
} from "../../../../../src/modules/chat/runtime/run-state-machine/turnRuntimeRegistry.js";
import { applyRunStateMessageRuntimePatch } from "../../../../../src/modules/chat/runtime/engine/messageRuntimePatch.js";
import { contributeExtension } from "../../../../../src/extensions/extension-registry.js";
import { EXTENSION_POINTS } from "../../../../../src/extensions/extension-point-ids.js";
import { registerFrontendPlugin as registerWorkflowFrontendPlugin } from "../../../../../../../plugin/noobot-plugin-workflow/frontend/index.js";

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

export function createFixture({ activeId = "s-1", processStore = null, currentRun = null } = {}) {
  registerWorkflowFrontendPlugin({
    contributeExtension: (point, contribution) => contributeExtension(point, {
      ...contribution,
      pluginId: "workflow",
    }),
    extensionPoints: EXTENSION_POINTS,
    services: {},
  });
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
      applyRunStateMessageRuntimePatch({
        sessions,
        turnRuntimeRegistry,
        event: result?.turn || event,
      });
      return result;
    }),
  );
  const resolveTurnTerminalState = vi.fn(async () => ({
    applied: false,
    reason: "terminal_unresolved",
  }));
  const applyWorkflowRuntimeEvent = vi.fn(() => ({ applied: true }));
  const applyTerminalResolution = (response) => {
    const result = applyTurnTerminalResolution(turnRuntimeRegistry.value, response);
    if (result?.applied) {
      turnRuntimeRegistry.value = { ...turnRuntimeRegistry.value };
      applyRunStateMessageRuntimePatch({
        sessions,
        activeSession,
        turnRuntimeRegistry,
        event: result.turn,
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
    applyWorkflowRuntimeEvent,
    resolveTurnTerminalState,
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
      applyWorkflowRuntimeEvent,
      resolveTurnTerminalState,
      applyTerminalResolution,
    },
  };
}
