/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  createChatSession,
  createSessionFixture,
  sessionLogClientMock,
  wsClientMock,
} from "./useChatSession.test-helpers.js";
import { useChatSession } from "../../../../../src/modules/chat/composables/useChatSession.js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { nextTick, ref, toRef } from "vue";
import { useChatStore } from "../../../../../src/modules/chat/stores/useChatStore.js";
import { classifyRealtimeLog } from "../../../../../src/app/state/sessionMessageState.js";
import { logResendDebug, setResendDebugLogSink } from "../../../../../src/modules/debug/loggers/resendDebugLogger.js";
import { RoleEnum, StreamEventEnum } from "../../../../../src/modules/chat/model/chatConstants.js";
import { selectToolTimeline, selectToolTimelineLogs } from "../../../../../src/modules/chat/runtime/engine/toolTimeline.js";
import { selectActivityTimelineLogs } from "../../../../../src/modules/chat/runtime/engine/activityTimeline.js";
import {
  BackendChannelState,
  FrontendRunState,
  SESSION_RUN_EVENT,
} from "../../../../../src/modules/chat/runtime/sessionRunStateMachine.js";
import { confirmTurnRuntimeDeletion } from "../../../../../src/modules/chat/runtime/run-state-machine/turnRuntimeRegistry.js";
describe("useChatSession reconnect replay", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    const store = useChatStore();
    store.resetChatStore();
    Object.values(wsClientMock).forEach((mockFn) => {
      if (typeof mockFn?.mockReset === "function") mockFn.mockReset();
    });
    wsClientMock.reconnect.mockResolvedValue(undefined);
    sessionLogClientMock.log.mockClear();
    sessionLogClientMock.debug.mockClear();
    sessionLogClientMock.isEnabled.mockReset();
    sessionLogClientMock.isEnabled.mockReturnValue(true);
    sessionLogClientMock.dispose.mockClear();
    setResendDebugLogSink(null);
    vi.unstubAllEnvs();
  });

  it("injects the session log websocket client into resend debug logger", () => {
    createChatSession();
    logResendDebug("resend.injected", {
      sessionId: "s-log",
      dialogProcessId: "dp-log",
      turnScopeId: "ts-log",
      detail: "through-session-log-client",
    });

    expect(sessionLogClientMock.debug).toHaveBeenCalledWith("resend", expect.any(Function));
    expect(sessionLogClientMock.debug.mock.results.at(-1).value).toEqual(expect.objectContaining({
      category: "debug",
      debugType: "resend",
      event: "resend.injected",
      sessionId: "s-log",
      dialogProcessId: "dp-log",
      turnScopeId: "ts-log",
      data: expect.objectContaining({
        event: "resend.injected",
        detail: "through-session-log-client",
      }),
    }));
  });

  it("does not recreate a confirmed-deleted Turn from reconnect message replay", async () => {
    const store = useChatStore();
    store.sessions = [createSessionFixture({
      id: "s-deleted",
      sessionId: "s-deleted",
      messages: [],
    })];
    store.activeSessionId = "s-deleted";
    confirmTurnRuntimeDeletion(store.turnRuntimeRegistry, "turn-deleted", { sessionId: "s-deleted" });
    wsClientMock.reconnect.mockImplementationOnce(async ({ onReconnectData }) => {
      onReconnectData({
        event: "content",
        data: {
          sessionId: "s-deleted",
          dialogProcessId: "dp-deleted",
          turnScopeId: "turn-deleted",
          sequence: 1,
          content: "must not reappear",
        },
      });
    });

    const session = createChatSession({ classifyRealtimeLog });
    await session.handleReconnect();

    expect(store.sessions[0].messages).toEqual([]);
    expect(store.turnRuntimeRegistry.sessions["s-deleted"]?.turns?.["turn-deleted"]).toBeUndefined();
  });

  it("projects live tool call and result received after refresh into the restored assistant", async () => {
    const store = useChatStore();
    const assistant = {
      id: "msg-live",
      messageId: "msg-live",
      role: RoleEnum.ASSISTANT,
      dialogProcessId: "dp-live",
      turnScopeId: "turn-live",
      content: "",
      pending: true,
      realtimeLogs: [],
    };
    store.sessions = [{
      id: "s-live",
      sessionId: "s-live",
      title: "live",
      isLocal: false,
      loaded: true,
      messages: [{ role: RoleEnum.USER, content: "run" }, assistant],
      rawMessages: [],
      sessionDocs: [],
      connectorPanelState: { selectedConnectors: {} },
      currentTaskId: "",
      currentTaskStatus: "running",
      messageCount: 2,
      lastMessage: assistant,
    }];
    store.activeSessionId = "s-live";
    const envelope = (eventType, sequence, extra = {}) => ({
      event: "message_event",
      data: {
        channelKind: "message_event",
        channelVersion: 1,
        route: { scope: "main_session", sessionId: "s-live" },
        event: {
          envelopeKind: "noobot.message_event",
          envelopeVersion: 2,
          eventId: `evt-${sequence}`,
          eventType,
          sessionId: "s-live",
          messageId: "msg-live",
          presentationMessageId: "msg-live",
          sequenceDomain: "message-event",
          sequenceScopeId: "msg-live",
          dialogProcessId: "dp-live",
          turnScopeId: "turn-live",
          sequence,
          timestamp: `2026-07-22T04:16:${String(sequence).padStart(2, "0")}.000Z`,
          tool: "read_file",
          toolCallId: "call-live",
          ...extra,
        },
      },
    });
    wsClientMock.reconnect.mockImplementationOnce(async ({ onReconnectData }) => {
      onReconnectData(envelope("tool_call_start", 1, { args: { filePath: "notes.txt" } }));
      onReconnectData(envelope("tool_call_end", 2, { result: { ok: true }, success: true }));
    });

    const session = createChatSession({ classifyRealtimeLog });
    await session.handleReconnect();

    expect(sessionLogClientMock.log).not.toHaveBeenCalledWith(expect.objectContaining({
      event: "frontend.thinkingReplay.liveProjectionTargetMissing",
    }));

    const restoredAssistant = store.sessions[0].messages.find(
      (message) => message.role === RoleEnum.ASSISTANT && message.dialogProcessId === "dp-live",
    );
    expect(selectToolTimelineLogs(restoredAssistant)).toEqual([
      expect.objectContaining({ type: "tool_call", toolCallId: "call-live" }),
      expect.objectContaining({ type: "tool_result", toolCallId: "call-live" }),
    ]);
    expect(selectToolTimeline(restoredAssistant)).toHaveLength(1);
  });

  it("keeps projecting message deltas that arrive after reconnect has completed", async () => {
    const store = useChatStore();
    const assistant = {
      id: "msg-after-reconnect",
      messageId: "msg-after-reconnect",
      role: RoleEnum.ASSISTANT,
      dialogProcessId: "dp-after-reconnect",
      turnScopeId: "turn-after-reconnect",
      content: "",
      pending: true,
      realtimeLogs: [],
    };
    store.sessions = [createSessionFixture({
      id: "s-after-reconnect",
      sessionId: "s-after-reconnect",
      messages: [{ role: RoleEnum.USER, content: "continue" }, assistant],
    })];
    store.activeSessionId = "s-after-reconnect";
    let deliverLiveEvent = null;
    wsClientMock.reconnect.mockImplementationOnce(async ({ onReconnectData }) => {
      deliverLiveEvent = onReconnectData;
    });
    const session = createChatSession({ classifyRealtimeLog });

    await session.handleReconnect();
    deliverLiveEvent({
      event: "message_event",
      data: {
        channelKind: "message_event",
        channelVersion: 1,
        route: { scope: "main_session", sessionId: "s-after-reconnect" },
        event: {
          envelopeKind: "noobot.message_event",
          envelopeVersion: 2,
          eventId: "evt-after-reconnect-delta",
          eventType: "llm_delta",
          sessionId: "s-after-reconnect",
          messageId: "msg-after-reconnect",
          presentationMessageId: "msg-after-reconnect",
          sequenceDomain: "message-event",
          sequenceScopeId: "msg-after-reconnect",
          dialogProcessId: "dp-after-reconnect",
          turnScopeId: "turn-after-reconnect",
          sequence: 1,
          timestamp: "2026-07-25T02:30:00.000Z",
          text: "message continued after replay",
        },
      },
    });

    await vi.waitFor(() => {
      expect(assistant.content).toContain("message continued after replay");
    });
    expect(assistant.messageEventState.consumedEventIds).toEqual([
      "evt-after-reconnect-delta",
    ]);
  });

  it("projects a stopped-turn continuation by turnScopeId when both assistants share a dialogProcessId", async () => {
    const store = useChatStore();
    const stoppedAssistant = {
      role: RoleEnum.ASSISTANT,
      dialogProcessId: "dp-continued",
      turnScopeId: "turn-stopped",
      content: "stopped answer",
      pending: false,
      realtimeLogs: [{ type: "thinking", text: "old thinking" }],
    };
    const continuedAssistant = {
      id: "msg-continued",
      messageId: "msg-continued",
      role: RoleEnum.ASSISTANT,
      dialogProcessId: "dp-continued",
      turnScopeId: "turn-continued",
      content: "",
      pending: true,
      realtimeLogs: [],
    };
    store.sessions = [{
      id: "s-continue",
      sessionId: "s-continue",
      title: "continue",
      isLocal: false,
      loaded: true,
      messages: [
        { role: RoleEnum.USER, content: "first", turnScopeId: "turn-stopped" },
        stoppedAssistant,
        { role: RoleEnum.USER, content: "continue", turnScopeId: "turn-continued" },
        continuedAssistant,
      ],
      rawMessages: [],
      sessionDocs: [],
      connectorPanelState: { selectedConnectors: {} },
      currentTaskId: "",
      currentTaskStatus: "running",
      messageCount: 4,
      lastMessage: continuedAssistant,
    }];
    store.activeSessionId = "s-continue";
    wsClientMock.reconnect.mockImplementationOnce(async ({ onReconnectData }) => {
      onReconnectData({
        event: "message_event",
        data: {
          channelKind: "message_event",
          channelVersion: 1,
          route: { scope: "main_session", sessionId: "s-continue" },
          event: {
            envelopeKind: "noobot.message_event",
            envelopeVersion: 2,
            eventId: "evt-continued-thinking",
            eventType: "thinking",
            sessionId: "s-continue",
            messageId: "msg-continued",
            presentationMessageId: "msg-continued",
            sequenceDomain: "message-event",
            sequenceScopeId: "msg-continued",
            dialogProcessId: "dp-continued",
            turnScopeId: "turn-continued",
            sequence: 1,
            timestamp: "2026-07-22T04:17:00.000Z",
            text: "new thinking",
          },
        },
      });
    });

    const session = createChatSession({ classifyRealtimeLog });
    await session.handleReconnect();

    expect(stoppedAssistant.realtimeLogs).toEqual([
      { type: "thinking", text: "old thinking" },
    ]);
    expect(selectActivityTimelineLogs(continuedAssistant)).toEqual([
      expect.objectContaining({ text: "new thinking" }),
    ]);
    expect(continuedAssistant.messageEventState.consumedEventIds).toEqual([
      "evt-continued-thinking",
    ]);
  });

  it("reconnect message_event patches only the assistant identified by messageId", async () => {
    const store = useChatStore();
    store.sessions = [
      {
        id: "s-1",
        sessionId: "s-1",
        title: "session",
        isLocal: false,
        loaded: true,
        messages: [
          { role: RoleEnum.USER, content: "old q" },
          { role: RoleEnum.ASSISTANT, messageId: "msg-old", presentationMessageId: "msg-old", dialogProcessId: "dp-old", turnScopeId: "turn-old", content: "old keep" },
          { role: RoleEnum.USER, content: "new q" },
          {
            role: RoleEnum.ASSISTANT,
            messageId: "msg-new",
            presentationMessageId: "msg-new",
            dialogProcessId: "dp-new",
            turnScopeId: "turn-new",
            content: "",
            pending: true,
            statusLabel: "",
          },
        ],
        rawMessages: [],
        sessionDocs: [],
        connectorPanelState: { selectedConnectors: {} },
        currentTaskId: "",
        currentTaskStatus: "idle",
        messageCount: 4,
        lastMessage: null,
        createdAt: "",
        updatedAt: "",
      },
    ];
    store.activeSessionId = "s-1";
    store.sending = true;
    store.pendingInteractionRequest = { requestId: "r1" };
    store.interactionSubmitting = true;

    wsClientMock.reconnect.mockImplementationOnce(async ({ onReconnectData }) => {
      onReconnectData({
        event: "message_event",
        data: {
          channelKind: "message_event",
          channelVersion: 1,
          route: { scope: "main_session", sessionId: "s-1" },
          event: {
            envelopeKind: "noobot.message_event",
            envelopeVersion: 2,
            eventId: "evt-new-final",
            eventType: "authoritative_final_content",
            sessionId: "s-1",
            messageId: "msg-new",
            presentationMessageId: "msg-new",
            sequenceDomain: "message-event",
            sequenceScopeId: "msg-new",
            dialogProcessId: "dp-new",
            turnScopeId: "turn-new",
            sequence: 1,
            timestamp: "2026-07-22T05:00:01.000Z",
            text: "new final answer",
            output: "new final answer",
            modelAlias: "alias-1",
          },
        },
      });
      onReconnectData({
        event: StreamEventEnum.DONE,
        data: {
          sessionId: "s-1",
          dialogProcessId: "dp-new",
          turnScopeId: "turn-new",
          messages: [
            { role: RoleEnum.USER, content: "old q" },
            {
              role: RoleEnum.ASSISTANT,
              messageId: "msg-old",
              presentationMessageId: "msg-old",
              dialogProcessId: "dp-old",
              turnScopeId: "turn-old",
              content: "old overwritten by snapshot",
            },
            { role: RoleEnum.USER, content: "new q" },
            {
              role: RoleEnum.ASSISTANT,
              messageId: "msg-new",
              presentationMessageId: "msg-new",
              dialogProcessId: "dp-new",
              turnScopeId: "turn-new",
              content: "new final answer",
              modelAlias: "alias-1",
            },
          ],
        },
      });
      onReconnectData({
        event: StreamEventEnum.CHANNEL_STATE,
        data: {
          sessionId: "s-1",
          dialogProcessId: "dp-new",
          turnScopeId: "turn-new",
          state: "completed",
          seq: 9,
        },
      });
    });

    const authFetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        ok: true,
        exists: true,
        sessionId: "s-1",
        sessions: [
          {
            sessionId: "s-1",
            messages: [
              { role: RoleEnum.USER, content: "old q" },
              { role: RoleEnum.ASSISTANT, messageId: "msg-old", presentationMessageId: "msg-old", dialogProcessId: "dp-old", turnScopeId: "turn-old", content: "old keep" },
              { role: RoleEnum.USER, content: "new q" },
              {
                role: RoleEnum.ASSISTANT,
                messageId: "msg-new",
                presentationMessageId: "msg-new",
                dialogProcessId: "dp-new",
                turnScopeId: "turn-new",
                content: "new final answer",
                modelAlias: "alias-1",
              },
            ],
          },
        ],
        messages: [
          { role: RoleEnum.USER, content: "old q" },
          { role: RoleEnum.ASSISTANT, messageId: "msg-old", presentationMessageId: "msg-old", dialogProcessId: "dp-old", turnScopeId: "turn-old", content: "old keep" },
          { role: RoleEnum.USER, content: "new q" },
          {
            role: RoleEnum.ASSISTANT,
            messageId: "msg-new",
            presentationMessageId: "msg-new",
            dialogProcessId: "dp-new",
            turnScopeId: "turn-new",
            content: "new final answer",
            modelAlias: "alias-1",
          },
        ],
      }),
    }));

    const session = useChatSession({
      userId: ref("u-1"),
      apiKey: ref(""),
      allowUserInteraction: ref(true),
      safeConfirm: ref(true),
      botScenario: ref(""),
      connected: ref(true),
      ensureConnected: vi.fn(() => true),
      authFetch,
      isImageMime: () => false,
      classifyRealtimeLog: (item) => item,
      scrollBottom: vi.fn(),
      notify: vi.fn(),
      clearUploadSelection: vi.fn(),
    });

    await session.handleReconnect();

    const activeSession = store.sessions[0];
    const oldAssistant = activeSession.messages.find(
      (message) => message.role === RoleEnum.ASSISTANT && message.dialogProcessId === "dp-old",
    );
    const newAssistant = activeSession.messages.find(
      (message) => message.role === RoleEnum.ASSISTANT && message.dialogProcessId === "dp-new",
    );

    expect(oldAssistant.content).toBe("old keep");
    expect(newAssistant.content).toBe("new final answer");
    expect(newAssistant.modelAlias).toBe("alias-1");
    const requestedUrls = authFetch.mock.calls.map(([url]) => url);
    expect(requestedUrls.some((url) => url.includes("/turns/turn-new/terminal"))).toBe(false);
    expect(store.turnRuntimeRegistry.sessions).toEqual({});
    // Message content is data-plane presentation only; lifecycle completion
    // must come from an Authority snapshot or lifecycle envelope.
    expect(newAssistant.pending).toBe(true);
  });


  it("passes current userId to reconnect websocket request", async () => {
    const store = useChatStore();
    store.sessions = [
      {
        id: "s-reconnect-user",
        sessionId: "s-reconnect-user",
        title: "session",
        isLocal: false,
        loaded: true,
        messages: [],
        rawMessages: [],
        sessionDocs: [],
        connectorPanelState: { selectedConnectors: {} },
        currentTaskId: "",
        currentTaskStatus: "idle",
        messageCount: 0,
        lastMessage: null,
        createdAt: "",
        updatedAt: "",
      },
    ];
    store.activeSessionId = "s-reconnect-user";

    const session = useChatSession({
      userId: ref("u-reconnect"),
      apiKey: ref(""),
      allowUserInteraction: ref(true),
      safeConfirm: ref(true),
      streamOutput: ref(true),
      botScenario: ref(""),
      connected: ref(true),
      ensureConnected: vi.fn(() => true),
      authFetch: null,
      isImageMime: () => false,
      classifyRealtimeLog: (item) => item,
      scrollBottom: vi.fn(),
      notify: vi.fn(),
      clearUploadSelection: vi.fn(),
    });

    await session.handleReconnect();

    expect(wsClientMock.reconnect).toHaveBeenCalledWith(expect.objectContaining({
      currentSessionId: "s-reconnect-user",
      userId: "u-reconnect",
    }));
  });

  it("restores a workflow Execution tree before its selected snapshot without double-consuming responses", async () => {
    const store = useChatStore();
    store.sessions = [createSessionFixture({ id: "workflow-session", sessionId: "workflow-session" })];
    store.activeSessionId = "workflow-session";
    store.turnRuntimeRegistry.sessions["workflow-session"] = {
      activeTurnScopeId: "workflow-turn",
      authoritativeSequence: 1,
      protocolVersion: 1,
      turns: {
        "workflow-turn": {
          sessionId: "workflow-session",
          turnScopeId: "workflow-turn",
          executionId: "workflow-root",
          state: FrontendRunState.PROCESSING,
        },
      },
    };
    store.turnRuntimeRegistry.executionIdByTurnScopeId["workflow-turn"] = "workflow-root";
    store.turnRuntimeRegistry.executions["workflow-root"] = {
      executionId: "workflow-root",
      executionKind: "workflow",
      rootExecutionId: "workflow-root",
      sessionId: "workflow-session",
      turnScopeId: "workflow-turn",
      revision: 1,
      sequence: 1,
      state: "processing",
    };

    const child = {
      executionId: "child-agent",
      executionKind: "agent",
      parentExecutionId: "workflow-root",
      rootExecutionId: "workflow-root",
      sessionId: "child-session",
      parentSessionId: "workflow-session",
      turnScopeId: "child-turn",
      revision: 2,
      sequence: 2,
      state: "processing",
    };
    const requestOrder = [];
    wsClientMock.requestJson.mockImplementation(async (payload) => {
      requestOrder.push(payload.commandType);
      if (payload.commandType === "execution.tree.get") {
        return {
          event: StreamEventEnum.EXECUTION_TREE,
          data: {
            commandId: payload.commandId,
            rootExecutionId: "workflow-root",
            tree: { executions: { "workflow-root": store.turnRuntimeRegistry.executions["workflow-root"], "child-agent": child } },
          },
        };
      }
      return {
        event: StreamEventEnum.EXECUTION_SNAPSHOT,
        data: { commandId: payload.commandId, execution: { ...store.turnRuntimeRegistry.executions["workflow-root"], revision: 2, sequence: 3 } },
      };
    });
    const authFetch = vi.fn(async () => ({ ok: true, json: async () => ({ ok: true, exists: true, messages: [] }) }));
    const session = createChatSession({ authFetch });

    await session.handleReconnect();

    expect(requestOrder).toEqual(["execution.tree.get", "execution.snapshot.get"]);
    expect(wsClientMock.requestJson).toHaveBeenNthCalledWith(1,
      expect.objectContaining({
        commandType: "execution.tree.get",
      }),
      expect.any(Object),
    );
    expect(wsClientMock.reconnect).toHaveBeenCalledWith(expect.objectContaining({
      currentSessionId: "workflow-session",
      knownLifecycleSequenceMap: { "workflow-session": 1 },
    }));
    expect(store.turnRuntimeRegistry.executions["child-agent"]).toMatchObject(child);
    expect(store.turnRuntimeRegistry.childExecutionIdsByParentId["workflow-root"]).toEqual(["child-agent"]);
    expect(store.turnRuntimeRegistry.executions["workflow-root"]).toMatchObject({ revision: 2, sequence: 3 });
    expect(authFetch).toHaveBeenCalledWith("/api/internal/session/u-1/workflow-session?mode=full");
  });

  it.each([
    ["手机端发消息，PC 端刷新", "mobile-sender", "pc-refresh"],
    ["PC 端发消息，手机端刷新", "pc-sender", "mobile-refresh"],
  ])("%s: reconnect 失败后只提示失败，不强制恢复发送中和停止按钮", async (_label, senderId, refresherId) => {
    const store = useChatStore();
    store.sessions = [
      {
        id: "s-cross-device",
        sessionId: "s-cross-device",
        title: "session",
        isLocal: false,
        loaded: true,
        messages: [
          { role: RoleEnum.USER, content: `hello from ${senderId}` },
          { role: RoleEnum.ASSISTANT, content: "", pending: false },
        ],
        rawMessages: [],
        sessionDocs: [],
        connectorPanelState: { selectedConnectors: {} },
        currentTaskId: "",
        currentTaskStatus: "idle",
        messageCount: 2,
        lastMessage: null,
        createdAt: "",
        updatedAt: "",
      },
    ];
    store.activeSessionId = "s-cross-device";
    store.sending = false;
    store.canStop = false;
    wsClientMock.reconnect.mockRejectedValueOnce(new Error("socket reconnect failed"));

    const authFetch = vi.fn();
    const notify = vi.fn();

    const session = useChatSession({
      userId: ref(refresherId),
      apiKey: ref(""),
      allowUserInteraction: ref(true),
      safeConfirm: ref(true),
      streamOutput: ref(true),
      botScenario: ref(""),
      connected: ref(true),
      ensureConnected: vi.fn(() => true),
      authFetch,
      isImageMime: () => false,
      classifyRealtimeLog: (item) => item,
      scrollBottom: vi.fn(),
      notify,
      clearUploadSelection: vi.fn(),
    });

    await session.handleReconnect();

    const assistant = store.sessions[0].messages.find(
      (message) => message.role === RoleEnum.ASSISTANT,
    );
    expect(authFetch).not.toHaveBeenCalled();
    expect(notify).toHaveBeenCalledWith({ type: "warning", message: "infra.reconnectFailed" });
    expect(sessionLogClientMock.log).toHaveBeenCalledWith(expect.objectContaining({
      category: "system",
      event: "reconnect.failed",
      sessionId: "s-cross-device",
      data: expect.objectContaining({
        event: "reconnect.failed",
        error: "socket reconnect failed",
      }),
    }));
    expect(assistant.pending).toBe(false);
    expect(session.sending.value).toBe(false);
    expect(session.canStop.value).toBe(false);
  });

});
