/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { ref } from "vue";
import { vi } from "vitest";
import { useChatEngine } from "../../../../../src/composables/chat/useChatEngine";
import { createSessionDetailApplicator } from "../../../../../src/composables/chat/chatList/sessionDetailApply";
import {
  RoleEnum,
  StreamEventEnum,
} from "../../../../../src/shared/constants/chatConstants";
import { BackendChannelState, SESSION_RUN_EVENT } from "../../../../../src/composables/chat/sessionRunStateMachine";
import {
  applyTurnRuntimeEvent,
  createTurnRuntimeRegistryState,
} from "../../../../../src/composables/chat/sessionRunStateMachine/turnRuntimeRegistry";

vi.mock("../../../../../src/shared/i18n/useLocale", () => ({
  useLocale: () => ({
    locale: ref("zh-CN"),
    translate: (key) => key,
  }),
}));

export const makeSession = (id, overrides = {}) => ({
  id,
  backendSessionId: id,
  title: "chat.newSession",
  loaded: false,
  messages: [],
  rawMessages: [],
  sessionDocs: [],
  connectorPanelState: { selectedConnectors: {} },
  messageCount: 0,
  lastMessage: null,
  updatedAt: "",
  ...overrides,
});

export const makeMessage = (role, content = "", attachments = []) => ({
  role,
  content,
  attachments,
  pending: false,
  statusLabel: "",
  realtimeLogs: [],
  executionLogTotal: 0,
  tool_calls: [],
});

let currentStreamTurnScopeId = "";

export const createHarness = ({
  sessionId,
  stream,
  pendingInteraction = null,
  interactionSubmittingValue = false,
  autoPatchStreamTurnScopeId = true,
  deps = {},
} = {}) => {
  const activeSessionId = ref(sessionId);
  const activeSession = ref(makeSession(sessionId));
  const sending = ref(false);
  const canStop = ref(false);
  const runStateSnapshot = ref(null);
  const turnRuntimeRegistry = ref(createTurnRuntimeRegistryState());
  const input = ref("hello");
  const uploadFiles = ref([]);
  const pendingInteractionRequest = ref(pendingInteraction);
  const interactionSubmitting = ref(interactionSubmittingValue);

  const appendMessage = vi.fn((role, content = "", attachments = []) => {
    const message = makeMessage(role, content, attachments);
    activeSession.value.messages.push(message);
    activeSession.value.rawMessages.push(message);
    activeSession.value.messageCount = activeSession.value.messages.length;
    activeSession.value.lastMessage = message;
    return message;
  });

  const defaultDeps = {
    userId: ref("u-1"),
    allowUserInteraction: ref(true),
    safeConfirm: ref(true),
    botScenario: ref(""),
    isImageMime: () => false,
    classifyRealtimeLog: (d) => d,
    scrollBottom: vi.fn(),
    activeSession,
    activeSessionId,
    sending,
    canStop,
    runStateSnapshot,
    turnRuntimeRegistry,
    input,
    uploadFiles,
    clearUploads: vi.fn(),
    serializeAttachments: vi.fn(async () => []),
    appendMessage,
    makeViewMessage: (message) => ({ ...message }),
    foldMessagesForView: (messages) => [...messages],
    fetchSessionDetail: vi.fn(async () => ({})),
    applySessionDetail: vi.fn(),
    refreshSessionConnectorsAsync: vi.fn(),
    connectorTypeSet: new Set(),
    upsertConnectedConnectorInPanelState: vi.fn(),
    pendingInteractionRequest,
    interactionSubmitting,
    clearPendingInteraction: vi.fn(() => {
      pendingInteractionRequest.value = null;
    }),
    clearPendingInteractionIfObsolete: vi.fn(),
    setPendingInteractionRequest: vi.fn(),
    submitInteractionResponse: vi.fn(),
    refreshSessionsAsync: vi.fn(),
    chatWebSocketClient: {
      stream: stream
        ? vi.fn(async (payload, onEvent) => {
            currentStreamTurnScopeId = String(payload?.turnScopeId || "").trim();
            const wrappedOnEvent = (envelope = {}) => {
              const data = envelope?.data && typeof envelope.data === "object" && !Array.isArray(envelope.data)
                ? envelope.data
                : null;
              if (
                autoPatchStreamTurnScopeId &&
                data &&
                data.turnScopeId === undefined &&
                String(data?.dialogProcessId || "").trim()
              ) {
                onEvent({ ...envelope, data: { ...data, turnScopeId: currentStreamTurnScopeId } });
                return;
              }
              onEvent(envelope);
            };
            try {
              return await stream(payload, wrappedOnEvent);
            } finally {
              currentStreamTurnScopeId = "";
            }
          })
        : vi.fn(),
      requestStop: vi.fn(),
      clearLastReceivedSeqMap: vi.fn(),
      dispose: vi.fn(),
      clearStopRequested: vi.fn(),
      isStopRequested: vi.fn(() => false),
    },
    ensureConnected: vi.fn(() => true),
    notify: vi.fn(),
  };

  const resolvedDeps = { ...defaultDeps, ...deps };
  const engine = useChatEngine(resolvedDeps);

  return {
    engine,
    deps: resolvedDeps,
    activeSession,
    activeSessionId,
    sending,
    canStop,
    runStateSnapshot,
    turnRuntimeRegistry,
    input,
    uploadFiles,
    pendingInteractionRequest,
    interactionSubmitting,
    appendMessage,
  };
};

export const activateRuntimeTurn = ({
  turnRuntimeRegistry,
  sessionId,
  turnScopeId,
  dialogProcessId = "",
} = {}) => {
  applyTurnRuntimeEvent(turnRuntimeRegistry.value, {
    type: SESSION_RUN_EVENT.LOCAL_SEND_REQUEST_STARTED,
    sessionId,
    turnScopeId,
  });
  applyTurnRuntimeEvent(turnRuntimeRegistry.value, {
    type: SESSION_RUN_EVENT.BACKEND_CHANNEL_STATE,
    sessionId,
    turnScopeId,
    dialogProcessId,
    state: BackendChannelState.SENDING,
  });
};

export const assistantMessage = (activeSession) =>
  activeSession.value.messages.find((message) => message.role === RoleEnum.ASSISTANT);

export const emitChannelState = (onEvent, sessionId, dialogProcessId, state, data = {}) => {
  const normalizedDialogProcessId = String(dialogProcessId || "").trim();
  const turnScopePatch =
    data?.turnScopeId !== undefined || !normalizedDialogProcessId
      ? {}
      : { turnScopeId: currentStreamTurnScopeId };
  onEvent({
    event: StreamEventEnum.CHANNEL_STATE,
    data: { sessionId, dialogProcessId, state, ...turnScopePatch, ...data },
  });
};
