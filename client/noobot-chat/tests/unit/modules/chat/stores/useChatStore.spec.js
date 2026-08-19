/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { beforeEach, describe, expect, it } from "vitest";
import { useChatStore } from "../../../../../src/modules/chat/stores/useChatStore.js";
import { canonicalWorkflowRuntimeEvent } from "../helpers/workflowRuntimeEventFixture.js";
import { WORKFLOW_RUNTIME_EVENT } from "@noobot/event-protocol/workflow-runtime-event";
import {
  applyMessageEvent,
  applySessionSnapshot,
  assistantMessages,
  commitPresentation,
  createSubSessionEvent,
  resetChatStore,
} from "./useChatStoreTestFixture.js";

describe("useChatStore sub session projection", () => {
  beforeEach(resetChatStore);

  it("applies strict eventId dedupe for repeated realtime events", () => {
    const store = useChatStore();
    commitPresentation(store);
    const first = applyMessageEvent(store, createSubSessionEvent({ content: "he" }));
    const second = applyMessageEvent(store, createSubSessionEvent({ content: "llo" }));

    expect(first.applied).toBe(true);
    expect(second.applied).toBe(false);
    expect(second.reason).toBe("duplicate");
    expect(assistantMessages(store)).toHaveLength(1);
    expect(assistantMessages(store)[0].content).toBe("he");
  });

  it("deduplicates the same child message sequence received from parent and child channels", () => {
    const store = useChatStore();
    commitPresentation(store);
    const first = applyMessageEvent(
      store,
      createSubSessionEvent({
        eventId: "parent-channel-event",
        sequence: 1,
        content: "文件写入成功。",
      }),
    );
    const duplicate = applyMessageEvent(
      store,
      createSubSessionEvent({
        eventId: "child-channel-event",
        sequence: 1,
        content: "文件写入成功。",
      }),
    );

    expect(first.applied).toBe(true);
    expect(duplicate).toMatchObject({ applied: false, reason: "duplicate_sequence" });
    expect(assistantMessages(store)[0]?.content).toBe("文件写入成功。");
  });

  it("converges workflow child streaming and non-streaming content on the final event", () => {
    const store = useChatStore();
    commitPresentation(store);
    applyMessageEvent(
      store,
      createSubSessionEvent({
        eventId: "delta-1",
        sequence: 1,
        eventType: "llm_delta",
        text: "draft ",
      }),
    );
    applyMessageEvent(
      store,
      createSubSessionEvent({
        eventId: "delta-2",
        sequence: 2,
        eventType: "llm_delta",
        text: "tokens",
      }),
    );
    applyMessageEvent(
      store,
      createSubSessionEvent({
        eventId: "final-3",
        sequence: 3,
        eventType: "authoritative_final_content",
        text: "authoritative final",
      }),
    );

    const message = assistantMessages(store)[0];
    expect(message).toMatchObject({
      content: "authoritative final",
      messageId: "msg-assistant-1",
    });
    expect(message.messageEventState.finalContentSequence).toBe(4);
  });

  it("merges delta, thinking, tool and lifecycle updates in sequence order", () => {
    const store = useChatStore();
    commitPresentation(store);
    applyMessageEvent(
      store,
      createSubSessionEvent({
        eventType: "llm_delta",
        eventId: "event-1",
        sequence: 1,
        content: "he",
        pending: true,
        status: "sending",
      }),
    );
    applyMessageEvent(
      store,
      createSubSessionEvent({ eventId: "event-2", sequence: 2, content: "llo" }),
    );
    applyMessageEvent(
      store,
      createSubSessionEvent({
        eventId: "event-3",
        sequence: 3,
        eventType: "thinking",
        text: "plan",
        content: "",
      }),
    );
    applyMessageEvent(
      store,
      createSubSessionEvent({
        eventId: "event-4",
        sequence: 4,
        eventType: "tool_call_start",
        tool: "search",
        toolCallId: "call-search",
        content: "",
      }),
    );
    applyMessageEvent(
      store,
      createSubSessionEvent({
        eventId: "event-5",
        sequence: 5,
        eventType: "tool_call_end",
        tool: "search",
        toolCallId: "call-search",
        result: "ok",
        success: true,
        content: "",
      }),
    );
    store.applyWorkflowRuntimeEvent(
      canonicalWorkflowRuntimeEvent(WORKFLOW_RUNTIME_EVENT.NODE_STATE, {
        eventId: "event-6",
        sequence: 6,
        revision: 1,
        sequenceDomain: "workflow-node-state",
        sessionId: "sub-session-1",
        parentSessionId: "main-session-1",
        workflowRunId: "workflow-1",
        nodeExecutionId: "node-1",
        dialogProcessId: "dialog-1",
        turnScopeId: "turn-1",
        status: "completed",
      }),
      { source: "test" },
    );

    const session = store.selectSubSessionMessages("sub-session-1");
    const assistant = assistantMessages(store)[0];
    expect(session?.messages).toHaveLength(2);
    expect(assistant).toMatchObject({ content: "hello", pending: true });
    expect(assistant.activityTimeline).toEqual([
      expect.objectContaining({ event: "thinking", text: "plan" }),
    ]);
    expect(assistant.toolTimeline).toEqual([
      expect.objectContaining({ tool: "search", result: "ok", status: "completed" }),
    ]);
    expect(store.selectSubSessionTurnRuntime("sub-session-1", "turn-1")).toBeNull();
    expect(session?.sequence).toBe(6);
    expect(session?.revision).toBe(1);
  });

  it("projects canonical backend tool envelopes into the assistant tool timeline", () => {
    const store = useChatStore();
    commitPresentation(store);
    const started = applyMessageEvent(
      store,
      createSubSessionEvent({
        eventType: "tool_call_start",
        eventId: "tool-start-1",
        sequence: 1,
        tool: "read_file",
        args: { filePath: "notes.txt" },
        toolCallId: "call-1",
      }),
    );
    const ended = applyMessageEvent(
      store,
      createSubSessionEvent({
        eventType: "tool_call_end",
        eventId: "tool-end-1",
        sequence: 2,
        tool: "read_file",
        result: "file body",
        success: true,
        toolCallId: "call-1",
      }),
    );

    expect(started.applied).toBe(true);
    expect(ended.applied).toBe(true);
    const message = assistantMessages(store)[0];
    expect(message?.role).toBe("assistant");
    expect(message?.toolTimeline).toEqual([
      expect.objectContaining({
        key: "call:call-1",
        tool: "read_file",
        args: { filePath: "notes.txt" },
        result: "file body",
        success: true,
        status: "completed",
      }),
    ]);
    expect(message?.messageEventState?.consumedEventIds).toEqual([
      "turn-1:msg-assistant-1:presentation",
      "tool-start-1",
      "tool-end-1",
    ]);
  });

  it("continues a REST-hydrated child session with realtime assistant tool events", () => {
    const store = useChatStore();
    applySessionSnapshot(store, {
      sessionId: "sub-session-1",
      parentSessionId: "main-session-1",
      messages: [
        {
          id: "msg-user-1",
          messageId: "msg-user-1",
          role: "user",
          content: "run child task",
          sessionId: "sub-session-1",
          dialogProcessId: "dialog-1",
          turnScopeId: "turn-1",
        },
      ],
    });
    commitPresentation(store, { userMessageId: "msg-user-1" });

    const result = applyMessageEvent(
      store,
      createSubSessionEvent({
        eventType: "tool_call_start",
        eventId: "tool-start-after-refresh",
        sequence: 1,
        tool: "write_file",
        toolCallId: "call-after-refresh",
      }),
    );

    expect(result.applied).toBe(true);
    const messages = store.selectSubSessionMessages("sub-session-1")?.messages || [];
    expect(messages.map((message) => message.role)).toEqual(["user", "assistant"]);
    expect(messages[1]).toMatchObject({
      id: "msg-assistant-1",
      sessionId: "sub-session-1",
      dialogProcessId: "dialog-1",
      turnScopeId: "turn-1",
      role: "assistant",
    });
    expect(messages[1].toolTimeline).toHaveLength(1);
    expect(messages[1].messageEventState.consumedEventIds).toEqual([
      "turn-1:msg-assistant-1:presentation",
      "tool-start-after-refresh",
    ]);
  });

  it("does not guess that a differently identified REST assistant is the canonical message", () => {
    const store = useChatStore();
    applySessionSnapshot(store, {
      sessionId: "sub-session-1",
      messages: [
        {
          id: "persisted-shell-id",
          messageId: "persisted-shell-id",
          role: "assistant",
          content: "",
          turnScopeId: "turn-1",
          dialogProcessId: "dialog-1",
        },
      ],
    });
    commitPresentation(store, { messageId: "canonical-message-1" });

    const result = applyMessageEvent(
      store,
      createSubSessionEvent({
        eventId: "canonical-event-1",
        messageId: "canonical-message-1",
        sequence: 1,
        content: "answer",
      }),
    );

    expect(result.applied).toBe(true);
    expect(assistantMessages(store)).toEqual([
      expect.objectContaining({ id: "persisted-shell-id", content: "" }),
      expect.objectContaining({
        id: "canonical-message-1",
        messageId: "canonical-message-1",
        role: "assistant",
        content: "answer",
      }),
    ]);
  });

  it("keeps stable identities separate when a different REST message arrives after realtime", () => {
    const store = useChatStore();
    commitPresentation(store, { messageId: "canonical-message-1" });
    applyMessageEvent(
      store,
      createSubSessionEvent({
        eventId: "canonical-event-1",
        messageId: "canonical-message-1",
        sequence: 1,
        content: "answer",
      }),
    );

    applySessionSnapshot(store, {
      sessionId: "sub-session-1",
      messages: [
        {
          id: "persisted-shell-id",
          messageId: "persisted-shell-id",
          role: "assistant",
          content: "",
          turnScopeId: "turn-1",
          dialogProcessId: "dialog-1",
        },
      ],
    });

    expect(assistantMessages(store)).toEqual([
      expect.objectContaining({ id: "persisted-shell-id", content: "" }),
      expect.objectContaining({
        id: "canonical-message-1",
        messageId: "canonical-message-1",
        content: "answer",
      }),
    ]);
  });

  it("keeps events ordered when realtime updates arrive out of sequence", () => {
    const store = useChatStore();
    commitPresentation(store);
    applyMessageEvent(
      store,
      createSubSessionEvent({ eventId: "event-1", sequence: 1, content: "first" }),
    );
    applyMessageEvent(
      store,
      createSubSessionEvent({ eventId: "event-2", sequence: 2, content: "second" }),
    );
    const earlier = applyMessageEvent(
      store,
      createSubSessionEvent({ eventId: "late-event-1", sequence: 1, content: "stale" }),
    );

    expect(earlier.applied).toBe(false);
    expect(earlier.reason).toBe("stale");
    expect(assistantMessages(store).map((message) => message.content)).toEqual(["firstsecond"]);
  });

  it("rejects a message-event cursor declared for another message scope", () => {
    const store = useChatStore();
    const result = applyMessageEvent(
      store,
      createSubSessionEvent({
        sequenceDomain: "message-event",
        sequenceScopeId: "different-message",
        content: "must not apply",
      }),
    );

    expect(result).toMatchObject({
      applied: false,
      reason: "invalid_authoritative_message_event",
      errors: ["sequence_scope_mismatch"],
    });
    expect(store.selectSubSessionMessages("sub-session-1")).toBeNull();
  });

  it("does not treat an unscoped snapshot sequence as message-event ordering", () => {
    const store = useChatStore();
    applySessionSnapshot(store, {
      sessionId: "sub-session-1",
      messages: [
        {
          id: "msg-assistant-1",
          messageId: "msg-assistant-1",
          role: "assistant",
          content: "persisted",
          turnScopeId: "turn-1",
          sequence: 999,
          revision: 999,
        },
      ],
    });
    commitPresentation(store);

    const result = applyMessageEvent(
      store,
      createSubSessionEvent({
        eventId: "event-live-1",
        sequence: 1,
        revision: 1,
        content: " live",
      }),
    );

    expect(result.applied).toBe(true);
    expect(assistantMessages(store)[0]).toMatchObject({
      sequence: 2,
      sequenceDomain: "message-event",
    });
  });

  it("keeps an independently identified runtime message separate from final content", () => {
    const store = useChatStore();
    applySessionSnapshot(store, {
      sessionId: "sub-session-1",
      parentSessionId: "main-session-1",
      status: "running",
      messages: [
        {
          id: "runtime-assistant-shell",
          messageId: "runtime-assistant-shell",
          role: "assistant",
          content: "",
          turnScopeId: "turn-1",
          dialogProcessId: "runtime-node-dialog",
          sequence: 5,
          revision: 2,
          sequenceDomain: "workflow-node-state",
        },
      ],
    });
    commitPresentation(store, { messageId: "authoritative-assistant-1" });

    const result = store.reduceSubSessionMessageEvent(
      createSubSessionEvent({
        eventId: "authoritative-final-1",
        eventType: "authoritative_final_content",
        messageId: "authoritative-assistant-1",
        sequence: 1,
        revision: 1,
        text: "authoritative child result",
      }),
      { source: "live" },
    );

    expect(result).toMatchObject({ applied: true });
    expect(assistantMessages(store)).toEqual([
      expect.objectContaining({ id: "runtime-assistant-shell", content: "" }),
      expect.objectContaining({
        id: "authoritative-assistant-1",
        messageId: "authoritative-assistant-1",
        content: "authoritative child result",
        sequence: 2,
        sequenceDomain: "message-event",
      }),
    ]);
    expect(store.selectSubSessionMessages("sub-session-1").sequenceByScopeKey).toMatchObject({
      "authoritative-assistant-1": 2,
    });
  });

  it("keeps node terminal state while reducing an interleaved sequence one final message", () => {
    const store = useChatStore();
    const identity = {
      workflowRunId: "workflow-1",
      nodeExecutionId: "node-1",
      sessionId: "sub-session-1",
      parentSessionId: "main-session-1",
      dialogProcessId: "runtime-node-dialog",
      turnScopeId: "turn-1",
    };
    store.applyWorkflowRuntimeEvent(
      canonicalWorkflowRuntimeEvent(WORKFLOW_RUNTIME_EVENT.NODE_STATE, {
        ...identity,
        status: "running",
        revision: 2,
        sequence: 5,
        eventId: "node-running-5",
      }),
      { source: "live" },
    );
    commitPresentation(store, {
      ...identity,
      messageId: "authoritative-assistant-after-node-state",
    });
    const finalMessage = store.reduceSubSessionMessageEvent(
      createSubSessionEvent({
        ...identity,
        eventId: "authoritative-final-after-node-state",
        eventType: "authoritative_final_content",
        messageId: "authoritative-assistant-after-node-state",
        sequence: 1,
        revision: 1,
        text: "done",
      }),
      { source: "live" },
    );
    const terminal = store.applyWorkflowRuntimeEvent(
      canonicalWorkflowRuntimeEvent(WORKFLOW_RUNTIME_EVENT.NODE_STATE, {
        ...identity,
        status: "succeeded",
        revision: 3,
        sequence: 6,
        eventId: "node-succeeded-6",
      }),
      { source: "live" },
    );

    expect(finalMessage).toMatchObject({ applied: true });
    expect(terminal).toMatchObject({ applied: true });
    const child = store.selectSubSessionMessages("sub-session-1");
    expect(child).toMatchObject({ status: "" });
    expect(child.workflowNodeState).toMatchObject({ status: "succeeded" });
    expect(assistantMessages(store)).toEqual([
      expect.objectContaining({
        messageId: "authoritative-assistant-after-node-state",
        content: "done",
      }),
    ]);
    expect(child.sequenceByDomain).toMatchObject({
      "workflow-node-state": 6,
      "message-event": 2,
    });
  });

  it("merges a persisted snapshot without erasing realtime increments", () => {
    const store = useChatStore();
    commitPresentation(store);
    applyMessageEvent(
      store,
      createSubSessionEvent({ eventId: "event-1", sequence: 1, content: "hello" }),
    );
    const snapshot = applySessionSnapshot(store, {
      sessionId: "sub-session-1",
      parentSessionId: "main-session-1",
      dialogProcessId: "dialog-1",
      turnScopeId: "turn-1",
      workflowRunId: "workflow-1",
      nodeExecutionId: "node-1",
      status: "processing",
      messages: [
        {
          id: "msg-assistant-1",
          messageId: "msg-assistant-1",
          role: "assistant",
          content: "hello",
          sequence: 1,
        },
        { id: "msg-2", messageId: "msg-2", role: "assistant", content: "world", sequence: 2 },
      ],
    });

    expect(snapshot.applied).toBe(true);
    expect(assistantMessages(store)).toHaveLength(2);
    expect(assistantMessages(store)[0].content).toBe("hello");
    expect(assistantMessages(store)[1].content).toBe("world");
    expect(store.selectSubSessionMessages("sub-session-1")?.eventsById?.["event-1"]).toBeTruthy();
  });

  it("rejects id-less REST messages instead of guessing identity by child turn and role", () => {
    const store = useChatStore();
    applySessionSnapshot(store, {
      sessionId: "sub-session-1",
      messages: [
        {
          role: "user",
          content: "same request",
          turnScopeId: "turn-1",
          dialogProcessId: "dialog-1",
        },
      ],
    });

    const result = applySessionSnapshot(store, {
      sessionId: "sub-session-1",
      messages: [
        {
          role: "user",
          content: "same request",
          turnScopeId: "turn-1",
          dialogProcessId: "dialog-1",
        },
      ],
    });

    expect(result).toMatchObject({ applied: false, reason: "missing_snapshot_message_identity" });
    expect(store.selectSubSessionMessages("sub-session-1")).toBeNull();
  });

  it("projects terminal workflow node state onto the isolated child session", () => {
    const store = useChatStore();
    store.applyWorkflowRuntimeEvent(
      canonicalWorkflowRuntimeEvent(WORKFLOW_RUNTIME_EVENT.NODE_STATE, {
        workflowRunId: "workflow-1",
        nodeExecutionId: "node-1",
        sessionId: "sub-session-1",
        parentSessionId: "main-session-1",
        dialogProcessId: "dialog-1",
        turnScopeId: "turn-1",
        status: "running",
        eventId: "node-running",
        revision: 1,
        sequence: 1,
      }),
    );
    applySessionSnapshot(store, {
      sessionId: "sub-session-1",
      status: "running",
      messages: [
        {
          id: "msg-user-request",
          messageId: "msg-user-request",
          role: "user",
          content: "request",
          turnScopeId: "turn-1",
        },
      ],
    });
    store.applyWorkflowRuntimeEvent(
      canonicalWorkflowRuntimeEvent(WORKFLOW_RUNTIME_EVENT.NODE_STATE, {
        workflowRunId: "workflow-1",
        nodeExecutionId: "node-1",
        sessionId: "sub-session-1",
        parentSessionId: "main-session-1",
        dialogProcessId: "dialog-1",
        turnScopeId: "turn-1",
        status: "succeeded",
        eventId: "node-succeeded",
        revision: 2,
        sequence: 2,
      }),
    );

    const session = store.selectSubSessionMessages("sub-session-1");
    expect(session.status).toBe("");
    expect(session.workflowNodeState).toMatchObject({ status: "succeeded" });
    expect(store.selectSubSessionTurnRuntime("sub-session-1", "turn-1")).toBeNull();
  });

  it("does not overwrite existing realtime content when snapshot messages are empty", () => {
    const store = useChatStore();
    commitPresentation(store);
    applyMessageEvent(
      store,
      createSubSessionEvent({ eventId: "event-1", sequence: 1, content: "hello" }),
    );
    applySessionSnapshot(store, {
      sessionId: "sub-session-1",
      messages: [],
      status: "processing",
    });

    expect(assistantMessages(store)).toHaveLength(1);
    expect(assistantMessages(store)[0].content).toBe("hello");
  });

  it("combines snapshot-owned lifecycle fields with realtime canonical timelines", () => {
    const store = useChatStore();
    commitPresentation(store);
    applyMessageEvent(
      store,
      createSubSessionEvent({
        content: "answer",
        eventType: "thinking",
        text: "Read the source",
      }),
    );

    applySessionSnapshot(store, {
      sessionId: "sub-session-1",
      status: "completed",
      messages: [
        {
          id: "msg-assistant-1",
          messageId: "msg-assistant-1",
          role: "assistant",
          content: "answer",
          status: "completed",
          pending: false,
          thinking: { summary: "done", steps: [] },
          pluginMeta: { interaction: null },
        },
      ],
    });

    const message = assistantMessages(store)[0];
    expect(message).toMatchObject({
      id: "msg-assistant-1",
      messageId: "msg-assistant-1",
      status: "completed",
      pending: false,
      pluginMeta: { interaction: null },
    });
    expect(message.activityTimeline).toEqual([
      expect.objectContaining({ event: "thinking", text: "Read the source" }),
    ]);
    expect(message).not.toHaveProperty("thinking");
  });

  it("lets authoritative snapshot message ids replace realtime temporary identities without duplicates", () => {
    const store = useChatStore();
    commitPresentation(store);
    applyMessageEvent(
      store,
      createSubSessionEvent({ eventId: "assistant-1", sequence: 1, content: "hello" }),
    );
    applyMessageEvent(
      store,
      createSubSessionEvent({
        eventType: "tool_call_start",
        eventId: "tool-1",
        sequence: 2,
        toolCallId: "call-1",
        tool: "search",
        args: {},
        content: "",
      }),
    );
    applyMessageEvent(
      store,
      createSubSessionEvent({
        eventType: "tool_call_end",
        eventId: "tool-2",
        sequence: 3,
        toolCallId: "call-1",
        tool: "search",
        result: "ok",
        success: true,
        content: "",
      }),
    );

    applySessionSnapshot(store, {
      sessionId: "sub-session-1",
      messages: [
        {
          id: "msg-assistant-1",
          messageId: "msg-assistant-1",
          role: "assistant",
          content: "hello",
          turnScopeId: "turn-1",
          sequence: 1,
        },
        {
          id: "msg-tool-1",
          messageId: "msg-tool-1",
          role: "tool",
          content: "ok",
          toolCallId: "call-1",
          sequence: 2,
        },
      ],
    });

    const messages = (store.selectSubSessionMessages("sub-session-1")?.messages || []).filter(
      (message) => message.role !== "user",
    );
    expect(messages.map((message) => message.id)).toEqual(["msg-assistant-1", "msg-tool-1"]);
    expect(messages).toHaveLength(2);
    expect(messages.some((message) => String(message.id).includes("turn-1:assistant"))).toBe(false);
    expect(messages.some((message) => String(message.id).includes("tool:call-1"))).toBe(false);
  });

  it("keeps multiple assistant turns and distinct tool calls separate during realtime projection", () => {
    const store = useChatStore();
    commitPresentation(store, { turnScopeId: "turn-1", messageId: "msg-1" });
    applyMessageEvent(
      store,
      createSubSessionEvent({
        eventId: "assistant-1",
        messageId: "msg-1",
        turnScopeId: "turn-1",
        sequence: 1,
        content: "first",
      }),
    );
    commitPresentation(store, { turnScopeId: "turn-2", messageId: "msg-2" });
    applyMessageEvent(
      store,
      createSubSessionEvent({
        eventId: "assistant-2",
        messageId: "msg-2",
        turnScopeId: "turn-2",
        sequence: 1,
        content: "second",
      }),
    );
    applyMessageEvent(
      store,
      createSubSessionEvent({
        eventType: "tool_call_start",
        eventId: "tool-1",
        messageId: "msg-2",
        turnScopeId: "turn-2",
        sequence: 2,
        toolCallId: "call-1",
        tool: "one",
        content: "",
      }),
    );
    applyMessageEvent(
      store,
      createSubSessionEvent({
        eventType: "tool_call_start",
        eventId: "tool-2",
        messageId: "msg-2",
        turnScopeId: "turn-2",
        sequence: 3,
        toolCallId: "call-2",
        tool: "two",
        content: "",
      }),
    );

    const messages = assistantMessages(store);
    expect(messages.map((message) => message.content)).toEqual(["first", "second"]);
    expect(messages[1].toolTimeline).toHaveLength(2);
    expect(messages[1].toolTimeline[1]).toMatchObject({ tool: "two" });
    expect(messages[1].messageEventState.consumedEventIds).toHaveLength(4);
    expect(store.selectSubSessionMessages("sub-session-1")?.sequenceByScopeKey).toMatchObject({
      "msg-1": 2,
      "msg-2": 4,
    });
  });
});
