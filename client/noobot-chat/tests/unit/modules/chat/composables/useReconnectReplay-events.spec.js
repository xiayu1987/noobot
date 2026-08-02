/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createAuthoritativeMessageEnvelope,
  createCanonicalAssistant,
  createFixture,
  createFakeProcessStore,
} from "../helpers/useReconnectReplayHelper.js";
import { BackendChannelState, SESSION_RUN_EVENT } from "../../../../../src/modules/chat/runtime/sessionRunStateMachine.js";
import { applyTurnRuntimeEvent } from "../../../../../src/modules/chat/runtime/run-state-machine/turnRuntimeRegistry.js";
import { RoleEnum, StreamEventEnum } from "../../../../../src/modules/chat/model/chatConstants.js";
import { selectActivityTimelineLogs } from "../../../../../src/modules/chat/runtime/engine/activityTimeline.js";
import { clearExtensionRegistry } from "../../../../../src/extensions/extension-registry.js";
import { createReplayBatch, createTurnLifecycleSnapshot, TURN_STATE } from "@noobot/event-protocol";

afterEach(() => {
  vi.useRealTimers();
  clearExtensionRegistry();
});

describe("useReconnectReplay", () => {
  it("does not let a live DONE snapshot replace a canonical assistant by weak turn identity", async () => {
    const { api, refs } = createFixture();
    const placeholder = {
      role: RoleEnum.ASSISTANT,
      type: "message",
      sessionId: "s-1",
      dialogProcessId: "dp-workflow-final",
      turnScopeId: "turn-workflow-final",
      content: "",
      pending: true,
      thinkingExpanded: true,
    };
    refs.activeSession.value.messages = [
      {
        role: RoleEnum.USER,
        content: "run workflow",
        sessionId: "s-1",
        dialogProcessId: "dp-workflow-final",
        turnScopeId: "turn-workflow-final",
      },
      placeholder,
    ];

    await api.applyReconnectEvent(StreamEventEnum.DONE, {
      sessionId: "s-1",
      dialogProcessId: "dp-workflow-final",
      turnScopeId: "turn-workflow-final",
      seq: 85,
      messages: [
        {
          role: RoleEnum.USER,
          content: "run workflow",
          sessionId: "s-1",
          dialogProcessId: "dp-workflow-final",
          turnScopeId: "turn-workflow-final",
        },
        {
          role: RoleEnum.ASSISTANT,
          type: "workflow",
          content: "workflow finalized",
          sessionId: "s-1",
          dialogProcessId: "dp-workflow-final",
          turnScopeId: "turn-workflow-final",
          pluginMessage: true,
          pluginMeta: {
            source: "workflow-plugin",
            kind: "workflow",
            phase: "planning",
            payload: { workflowRunId: "workflow-final" },
          },
        },
      ],
    });

    expect(refs.activeSession.value.messages).toHaveLength(2);
    expect(refs.activeSession.value.messages[1]).toMatchObject({
      content: "",
      pending: true,
      thinkingExpanded: true,
    });
  });

  it("does not let data-plane completion replace the Authority lifecycle", async () => {
    const { api, refs, mocks } = createFixture();
    refs.activeSession.value.messages = [
      {
        role: RoleEnum.USER,
        content: "run workflow",
        sessionId: "s-1",
        dialogProcessId: "dp-terminal-order",
        turnScopeId: "turn-terminal-order",
      },
    ];
    await api.applyReconnectEvent(StreamEventEnum.TURN_LIFECYCLE, {
      eventType: "turn.completed",
      sessionId: "s-1",
      dialogProcessId: "dp-terminal-order",
      turnScopeId: "turn-terminal-order",
      seq: 91,
      sequence: 2,
    });
    await api.applyReconnectEvent(StreamEventEnum.CHANNEL_STATE, {
      sessionId: "s-1",
      dialogProcessId: "dp-terminal-order",
      turnScopeId: "turn-terminal-order",
      state: BackendChannelState.COMPLETED,
      seq: 93,
    });
    await api.applyReconnectEvent(StreamEventEnum.DONE, {
      sessionId: "s-1",
      dialogProcessId: "dp-terminal-order",
      turnScopeId: "turn-terminal-order",
      seq: 93,
      messages: [refs.activeSession.value.messages[0]],
    });

    expect(refs.activeSession.value.messages).toHaveLength(1);
    expect(mocks.chatList.fetchSessionDetail).not.toHaveBeenCalled();
  });

  it("routes a live child canonical event through the same sub-session reducer as reconnect replay", async () => {
    const { api, mocks } = createFixture();
    const messageEvent = createAuthoritativeMessageEnvelope("tool_call_start", {
      eventId: "evt-child-live-1",
      messageId: "msg-child-live-1",
      presentationMessageId: "msg-child-live-1",
      sessionId: "child-session",
      dialogProcessId: "child-dialog",
      turnScopeId: "workflow-node:node-1",
      seq: 1,
      tool: "child-tool",
      toolCallId: "call-child-1",
      args: {},
    }).data.event;

    const result = await api.applyReconnectEvent("subagent_message_event", {
      sessionId: "child-session",
      dialogProcessId: "child-dialog",
      turnScopeId: "workflow-node:node-1",
      seq: 42,
      route: { scope: "sub_session", rootSessionId: "s-1" },
      event: messageEvent,
    });

    expect(result).toEqual({ applied: true });
    expect(mocks.applyWorkflowRuntimeEvent).toHaveBeenCalledTimes(1);
    expect(mocks.applyWorkflowRuntimeEvent).toHaveBeenCalledWith(
      {
        event: "workflow_message_event",
        data: messageEvent,
        transportSequence: 42,
      },
      { source: "reconnect" },
    );
  });

  it("projects workflow planning events replayed after a page refresh", async () => {
    const { api, mocks } = createFixture();
    const data = {
      sessionId: "s-1",
      dialogProcessId: "dp-workflow",
      turnScopeId: "turn-workflow",
      workflowRunId: "workflow-1",
      nodeSessions: [{ nodeExecutionId: "node-1" }],
    };

    await api.applyReconnectEvent("workflow_planning_message_prepared", data);

    expect(mocks.applyWorkflowRuntimeEvent).toHaveBeenCalledWith({
      event: "workflow_planning_message_prepared",
      data,
      transportSequence: 0,
    }, { source: "reconnect" });
    expect(mocks.applyTurnRuntimeEvents).not.toHaveBeenCalled();
  });

  it("EV-02: THINKING updates logs and keeps pending true", async () => {
    const { api, refs } = createFixture();
    refs.activeSession.value.messages = [
      { role: RoleEnum.USER, content: "q" },
      createCanonicalAssistant({ dialogProcessId: "dp-t" }),
    ];

    await api.applyCanonicalMessageEvent("thinking", {
      sessionId: "s-1",
      dialogProcessId: "dp-t",
      seq: 1,
      event: "execution_step",
      text: "thinking",
    });

    const assistant = refs.activeSession.value.messages.find(
      (message) => message.role === RoleEnum.ASSISTANT && message.dialogProcessId === "dp-t",
    );
    expect(assistant?.pending).toBe(true);
    expect(selectActivityTimelineLogs(assistant)).toHaveLength(1);
  });

  it("EV-01: DELTA appends content and keeps pending unchanged", async () => {
    const { api, refs } = createFixture();
    refs.activeSession.value.messages = [
      { role: RoleEnum.USER, content: "q" },
      createCanonicalAssistant({ dialogProcessId: "dp-delta" }),
    ];

    await api.applyCanonicalMessageEvent("llm_delta", {
      sessionId: "s-1",
      dialogProcessId: "dp-delta",
      seq: 1,
      text: "A",
    });
    await api.applyCanonicalMessageEvent("llm_delta", {
      sessionId: "s-1",
      dialogProcessId: "dp-delta",
      seq: 2,
      text: "B",
    });

    const assistant = refs.activeSession.value.messages.find(
      (message) => message.role === RoleEnum.ASSISTANT && message.dialogProcessId === "dp-delta",
    );
    expect(assistant?.content).toBe("AB");
    expect(assistant?.pending).toBe(true);
  });

  it("EV-01c: replay in-flight DELTA does not restore sending without channel_state", async () => {
    const { api, refs } = createFixture();
    refs.activeSession.value.messages = [{ role: RoleEnum.USER, content: "q" }];

    await api.applyReconnectEvent(StreamEventEnum.DELTA, {
      sessionId: "s-1",
      dialogProcessId: "dp-sending",
      seq: 1,
      text: "A",
    });

    expect(refs.sending.value).toBe(false);
  });

  it("EV-01d: channel_state sending is transport-only", async () => {
    const { api, refs } = createFixture();
    applyTurnRuntimeEvent(refs.turnRuntimeRegistry.value, {
      type: SESSION_RUN_EVENT.LOCAL_SEND_REQUEST_STARTED,
      sessionId: "s-1",
      turnScopeId: "turn-cs",
    });

    await api.applyReconnectEvent(StreamEventEnum.CHANNEL_STATE, {
      sessionId: "s-1",
      turnScopeId: "turn-cs",
      dialogProcessId: "dp-cs",
      state: "sending",
      seq: 11,
    });

    expect(refs.sending.value).toBe(true);
  });

  it("EV-01e: channel_state reconnecting is transport-only", async () => {
    const { api, refs } = createFixture();
    applyTurnRuntimeEvent(refs.turnRuntimeRegistry.value, {
      type: SESSION_RUN_EVENT.LOCAL_SEND_REQUEST_STARTED,
      sessionId: "s-1",
      turnScopeId: "turn-reconnecting",
    });

    await api.applyReconnectEvent(StreamEventEnum.CHANNEL_STATE, {
      sessionId: "s-1",
      turnScopeId: "turn-reconnecting",
      dialogProcessId: "",
      state: "reconnecting",
      seq: 12,
    });

    expect(refs.sending.value).toBe(true);
  });

  it("EV-01f: turnless channel_state stopping does not guess an assistant or acquire the global lock", async () => {
    const { api, refs } = createFixture();
    refs.activeSession.value.messages = [
      { role: RoleEnum.USER, content: "q" },
      { role: RoleEnum.ASSISTANT, dialogProcessId: "dp-stop", content: "", pending: true },
    ];

    await api.applyReconnectEvent(StreamEventEnum.CHANNEL_STATE, {
      sessionId: "s-1",
      dialogProcessId: "dp-stop",
      state: "stopping",
      seq: 12,
    });

    const assistant = refs.activeSession.value.messages.find(
      (message) => message.role === RoleEnum.ASSISTANT && message.dialogProcessId === "dp-stop",
    );
    expect(refs.sending.value).toBe(false);
    expect(assistant?.statusLabelKey).toBeUndefined();
    expect(assistant?.channelState).toBeUndefined();
    expect(assistant?.pending).toBe(true);
  });

  it("EV-01g: stale terminal channel_state does not clear current local turn scope", async () => {
    const { api, refs } = createFixture();
    applyTurnRuntimeEvent(refs.turnRuntimeRegistry.value, {
      type: SESSION_RUN_EVENT.LOCAL_SEND_REQUEST_STARTED,
      sessionId: "s-1",
      turnScopeId: "client-current",
    });
    applyTurnRuntimeEvent(refs.turnRuntimeRegistry.value, {
      type: SESSION_RUN_EVENT.BACKEND_CHANNEL_STATE,
      sessionId: "s-1",
      turnScopeId: "client-current",
      state: BackendChannelState.SENDING,
    });

    await api.applyReconnectEvent(StreamEventEnum.CHANNEL_STATE, {
      sessionId: "s-1",
      dialogProcessId: "dp-stale",
      state: "completed",
      seq: 99,
    });

    expect(refs.sending.value).toBe(true);
    expect(refs.activeTurnRuntime.value?.turnScopeId).toBe("client-current");
  });

  it("EV-02b: replay in-flight THINKING does not restore sending without channel_state", async () => {
    const { api, refs } = createFixture();
    refs.activeSession.value.messages = [{ role: RoleEnum.USER, content: "q" }];

    await api.applyReconnectEvent("message", {
      sessionId: "s-1",
      dialogProcessId: "dp-thinking",
      seq: 1,
      text: "thinking",
    });

    expect(refs.sending.value).toBe(false);
  });

  it("EV-01b: reconnect transaction hydrates detail before canonical replay updates the explicit assistant identity", async () => {
    const { api, refs, mocks } = createFixture();
    refs.activeSession.value.messages = [
      { role: RoleEnum.USER, content: "old-q", ts: 1 },
      { role: RoleEnum.ASSISTANT, dialogProcessId: "dp-old", content: "old-a", ts: 2, pending: false },
    ];
    refs.activeSession.value.rawMessages = [...refs.activeSession.value.messages];

    mocks.chatList.fetchSessionDetail = vi.fn(async () => ({
      sessionId: "s-1",
      sessions: [
        {
          sessionId: "s-1",
          messages: [
            { role: RoleEnum.USER, content: "old-q", ts: 1 },
            { role: RoleEnum.ASSISTANT, dialogProcessId: "dp-old", content: "old-a", ts: 2 },
            { role: RoleEnum.USER, content: "new-q", ts: 3 },
            createCanonicalAssistant({
              sessionId: "s-1",
              messageId: "message-dp-new",
              dialogProcessId: "dp-new",
              turnScopeId: "turn-dp-new",
              ts: 4,
            }),
          ],
        },
      ],
    }));
    mocks.chatList.applySessionDetail = vi.fn((detail) => {
      const main = (detail?.sessions || [])[0] || {};
      refs.activeSession.value.messages = (main.messages || []).map((message) => ({ ...message }));
      refs.activeSession.value.rawMessages = [...refs.activeSession.value.messages];
    });

    const envelope = createAuthoritativeMessageEnvelope("llm_delta", {
      sessionId: "s-1",
      dialogProcessId: "dp-new",
      turnScopeId: "turn-dp-new",
      messageId: "message-dp-new",
      seq: 1,
      text: "A",
    });
    const snapshot = createTurnLifecycleSnapshot({
      commandId: "command-dp-new",
      userId: "admin",
      sessionId: "s-1",
      sequence: 1,
      activeTurnScopeId: "turn-dp-new",
      activeTurn: {
        userId: "admin",
        sessionId: "s-1",
        turnScopeId: "turn-dp-new",
        messageId: "message-dp-new",
        presentationMessageId: "message-dp-new",
        dialogProcessId: "dp-new",
        state: TURN_STATE.PROCESSING,
        executionState: "sending",
        revision: 1,
        sequence: 1,
      },
    });
    await api.applyReconnectData({
      sessions: [{
        sessionId: "s-1",
        replayBatch: createReplayBatch({
          sessionId: "s-1",
          streamId: "stream-s-1",
          requestId: "reconnect-s-1",
          snapshot,
          snapshotSequence: 1,
        }),
        dialogProcesses: [{
          dialogProcessId: "dp-new",
          messages: [envelope],
        }],
      }],
    });

    const userIdx = refs.activeSession.value.messages.findIndex(
      (message) => message.role === RoleEnum.USER && message.content === "new-q",
    );
    const assistantIdx = refs.activeSession.value.messages.findIndex(
      (message) =>
        message.role === RoleEnum.ASSISTANT &&
        message.dialogProcessId === "dp-new" &&
        message.content === "A",
    );
    expect(mocks.chatList.fetchSessionDetail).toHaveBeenCalledWith("s-1", {
      source: "reconnectProtocolReconcile",
    });
    expect(mocks.chatList.applySessionDetail).toHaveBeenCalledTimes(1);
    expect(userIdx).toBeGreaterThanOrEqual(0);
    expect(assistantIdx).toBeGreaterThan(userIdx);
    expect(refs.activeSession.value.messages[assistantIdx]).toMatchObject({
      id: "message-dp-new",
      messageId: "message-dp-new",
      content: "A",
    });
  });

  it("EV-03: INTERACTION_REQUEST sets pending interaction without terminal cleanup", async () => {
    const { api, refs, mocks } = createFixture();
    refs.interactionSubmitting.value = false;
    refs.activeSession.value.messages = [
      { role: RoleEnum.USER, content: "q" },
      { role: RoleEnum.ASSISTANT, dialogProcessId: "dp-int", content: "", pending: true },
    ];

    await api.applyReconnectEvent(StreamEventEnum.INTERACTION_REQUEST, {
      sessionId: "s-1",
      dialogProcessId: "dp-int",
      seq: 1,
      requestId: "req-1",
      interactionType: "confirm",
    });

    expect(mocks.setPendingInteractionRequest).toHaveBeenCalledTimes(1);
    expect(mocks.clearPendingInteraction).not.toHaveBeenCalled();
    expect(mocks.clearPendingInteractionIfObsolete).not.toHaveBeenCalled();
    expect(refs.interactionSubmitting.value).toBe(false);
  });

  it("EV-03b: non-interaction replay event does not clear interaction without channel_state", async () => {
    const { api, refs, mocks } = createFixture();
    refs.activeSession.value.messages = [
      { role: RoleEnum.USER, content: "q" },
      { role: RoleEnum.ASSISTANT, dialogProcessId: "dp-int2", content: "", pending: true },
    ];

    await api.applyReconnectEvent(StreamEventEnum.INTERACTION_REQUEST, {
      sessionId: "s-1",
      dialogProcessId: "dp-int2",
      seq: 1,
      requestId: "req-2",
      interactionType: "confirm",
    });
    await api.applyReconnectEvent(StreamEventEnum.DELTA, {
      sessionId: "s-1",
      dialogProcessId: "dp-int2",
      seq: 2,
      text: "resume",
    });

    expect(mocks.clearPendingInteractionIfObsolete).not.toHaveBeenCalled();
  });

  it("EV-03b2: auto-resolved interaction replay does not enter pending", async () => {
    const { api, mocks } = createFixture();

    await api.applyReconnectEvent(StreamEventEnum.INTERACTION_REQUEST, {
      sessionId: "s-1",
      dialogProcessId: "dp-int2-auto",
      seq: 1,
      requestId: "req-2-auto",
      interactionType: "post_action_notice",
      lifecycle: "resolved",
      ackMode: "auto",
    });

    expect(mocks.setPendingInteractionRequest).not.toHaveBeenCalled();
    expect(mocks.clearPendingInteraction).toHaveBeenCalled();
  });

  it("EV-03c: channel_state completed has no business side effects", async () => {
    const { api, mocks } = createFixture();

    await api.applyReconnectEvent(StreamEventEnum.CHANNEL_STATE, {
      sessionId: "s-1",
      dialogProcessId: "dp-int3",
      turnScopeId: "turn-int3",
      state: "completed",
      seq: 12,
    });

    expect(mocks.resolveTurnTerminalState).not.toHaveBeenCalled();
    expect(mocks.clearPendingInteractionIfObsolete).not.toHaveBeenCalled();
  });

  it("EV-03d: channel_state interaction_pending has no pending-interaction side effects", async () => {
    const { api, refs, mocks } = createFixture();
    refs.interactionSubmitting.value = false;

    await api.applyReconnectEvent(StreamEventEnum.CHANNEL_STATE, {
      sessionId: "s-1",
      dialogProcessId: "dp-int4",
      state: "interaction_pending",
      seq: 13,
      pendingInteraction: {
        requestId: "req-4",
        sessionId: "s-1",
        dialogProcessId: "dp-int4",
        interactionType: "confirm",
        content: "need confirm",
      },
    });

    expect(refs.interactionSubmitting.value).toBe(false);
    expect(mocks.setPendingInteractionRequest).not.toHaveBeenCalled();
  });

  it("EV-03e: channel_state sending never clears pending interaction", async () => {
    const { api, mocks } = createFixture();

    await api.applyReconnectEvent(StreamEventEnum.CHANNEL_STATE, {
      sessionId: "s-1",
      dialogProcessId: "dp-int5",
      state: "sending",
      seq: 14,
    });
    expect(mocks.clearPendingInteractionIfObsolete).not.toHaveBeenCalled();

    await api.applyReconnectEvent(StreamEventEnum.CHANNEL_STATE, {
      sessionId: "s-1",
      dialogProcessId: "dp-int5",
      state: "sending",
      sourceEvent: "interaction_response",
      requestId: "req-int5",
      seq: 15,
    });
    expect(mocks.clearPendingInteractionIfObsolete).not.toHaveBeenCalled();
  });
});
