/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { beforeEach, describe, expect, it } from "vitest";
import { useChatStore } from "../../../../../src/modules/chat/stores/useChatStore.js";
import {
  applyMessageEvent,
  applySessionSnapshot,
  assistantMessages,
  commitPresentation,
  createSubSessionEvent,
  resetChatStore,
} from "./useChatStoreTestFixture.js";

describe("useChatStore sub session snapshot reconciliation", () => {
  beforeEach(resetChatStore);

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

  it("merges a persisted snapshot without erasing realtime increments", () => {
    const store = useChatStore();
    commitPresentation(store);
    applyMessageEvent(
      store,
      createSubSessionEvent({
        eventId: "event-1",
        eventType: "thinking",
        sequence: 1,
        text: "hello",
      }),
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
      expect.objectContaining({ eventType: "thinking", text: "Read the source" }),
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
});
