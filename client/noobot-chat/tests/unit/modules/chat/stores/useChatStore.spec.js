/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { beforeEach, describe, expect, it } from "vitest";
import { useChatStore } from "../../../../../src/modules/chat/stores/useChatStore.js";
import { canonicalWorkflowNodeStateEvent } from "../helpers/workflowRuntimeEventFixture.js";
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

    const first = applyMessageEvent(
      store,
      createSubSessionEvent({ eventType: "thinking", text: "he" }),
    );
    const second = applyMessageEvent(
      store,
      createSubSessionEvent({ eventType: "thinking", sequence: 2, text: "llo" }),
    );

    expect(first.applied).toBe(true);
    expect(second.applied).toBe(false);
    expect(second.reason).toBe("duplicate");
    expect(assistantMessages(store)).toHaveLength(1);
    expect(assistantMessages(store)[0].activityTimeline).toEqual([
      expect.objectContaining({ eventType: "thinking", text: "he" }),
    ]);
  });

  it("deduplicates the same child message sequence received from parent and child channels", () => {
    const store = useChatStore();
    commitPresentation(store);
    const first = applyMessageEvent(
      store,
      createSubSessionEvent({
        eventId: "parent-channel-event",
        eventType: "thinking",
        sequence: 1,
        text: "文件写入成功。",
      }),
    );
    const duplicate = applyMessageEvent(
      store,
      createSubSessionEvent({
        eventId: "child-channel-event",
        eventType: "thinking",
        sequence: 1,
        text: "文件写入成功。",
      }),
    );

    expect(first.applied).toBe(true);
    expect(duplicate).toMatchObject({ applied: false, reason: "duplicate_sequence" });
    expect(assistantMessages(store)[0]?.activityTimeline).toEqual([
      expect.objectContaining({ text: "文件写入成功。" }),
    ]);
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
        sequence: 1,
        eventType: "authoritative_final_content",
        text: "authoritative final",
      }),
    );

    const message = assistantMessages(store)[0];
    expect(message).toMatchObject({
      content: "authoritative final",
      presentationMessageId: "msg-assistant-1",
    });
    expect(message.messageEventState.finalContentSequence).toBe(2);
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
        sequence: 1,
        eventType: "thinking",
        text: "plan",
        content: "",
      }),
    );
    applyMessageEvent(
      store,
      createSubSessionEvent({
        eventId: "event-4",
        sequence: 2,
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
        sequence: 3,
        eventType: "tool_call_end",
        tool: "search",
        toolCallId: "call-search",
        result: "ok",
        success: true,
        content: "",
      }),
    );
    store.applyWorkflowRuntimeEvent(
      canonicalWorkflowNodeStateEvent({
        eventId: "event-6",
        sequence: 6,
        revision: 1,
        nodeSessionId: "sub-session-1",
        authoritySessionId: "main-session-1",
        workflowRunId: "workflow-1",
        nodeExecutionId: "node-1",
        dialogProcessId: "dialog-1",
        turnScopeId: "turn-1",
        status: "succeeded",
      }),
      { source: "test" },
    );

    const session = store.selectSubSessionMessages("sub-session-1");
    const assistant = assistantMessages(store)[0];
    expect(session?.messages).toHaveLength(2);
    expect(assistant).toMatchObject({ content: "hello", pending: true });
    expect(assistant.activityTimeline).toEqual([
      expect.objectContaining({ eventType: "thinking", text: "plan" }),
    ]);
    expect(assistant.toolTimeline).toEqual([
      expect.objectContaining({ tool: "search", result: "ok", status: "completed" }),
    ]);
    expect(session?.turnRuntime).toBeNull();

    expect(session.sequenceByScopeKey).toEqual({ "msg-assistant-1": 4 });
    expect(session).not.toHaveProperty("revision");
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

  it("keeps events ordered when realtime updates arrive out of sequence", () => {
    const store = useChatStore();
    commitPresentation(store);
    applyMessageEvent(
      store,
      createSubSessionEvent({
        eventId: "event-1",
        eventType: "thinking",
        sequence: 1,
        text: "first",
      }),
    );
    applyMessageEvent(
      store,
      createSubSessionEvent({
        eventId: "event-2",
        eventType: "thinking",
        sequence: 2,
        text: "second",
      }),
    );
    const earlier = applyMessageEvent(
      store,
      createSubSessionEvent({
        eventId: "late-event-1",
        eventType: "thinking",
        sequence: 1,
        text: "stale",
      }),
    );

    expect(earlier.applied).toBe(false);
    expect(earlier.reason).toBe("stale");
    expect(assistantMessages(store)[0].activityTimeline.map((item) => item.text)).toEqual([
      "first",
      "second",
    ]);
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
      nodeSessionId: "sub-session-1",
      messages: [
        {
          messageUid: "sm-msg-assistant-1",
          presentationMessageId: "msg-assistant-1",
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
        eventType: "thinking",
        sequence: 1,
        text: " live",
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
      nodeSessionId: "sub-session-1",
      authoritySessionId: "main-session-1",
      status: "running",
      messages: [
        {
          messageUid: "sm-runtime-assistant-shell",
          presentationMessageId: "runtime-assistant-shell",
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
    commitPresentation(store, { presentationMessageId: "authoritative-assistant-1" });

    const result = store.reduceSubSessionMessageEvent(
      createSubSessionEvent({
        eventId: "authoritative-final-1",
        eventType: "authoritative_final_content",
        presentationMessageId: "authoritative-assistant-1",
        sequence: 1,
        text: "authoritative child result",
      }),
      { source: "live" },
    );

    expect(result).toMatchObject({ applied: true });
    expect(assistantMessages(store)).toEqual([
      expect.objectContaining({ presentationMessageId: "runtime-assistant-shell", content: "" }),
      expect.objectContaining({
        presentationMessageId: "authoritative-assistant-1",
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
      canonicalWorkflowNodeStateEvent({
        workflowRunId: "workflow-1",
        nodeExecutionId: "node-1",
        nodeSessionId: "sub-session-1",
        authoritySessionId: "main-session-1",
        dialogProcessId: "runtime-node-dialog",
        turnScopeId: "turn-1",
        status: "running",
        revision: 2,
        sequence: 5,
        eventId: "node-running-5",
      }),
      { source: "live" },
    );
    commitPresentation(store, {
      ...identity,
      presentationMessageId: "authoritative-assistant-after-node-state",
    });
    const finalMessage = store.reduceSubSessionMessageEvent(
      createSubSessionEvent({
        ...identity,
        eventId: "authoritative-final-after-node-state",
        eventType: "authoritative_final_content",
        presentationMessageId: "authoritative-assistant-after-node-state",
        sequence: 1,
        text: "done",
      }),
      { source: "live" },
    );
    const terminal = store.applyWorkflowRuntimeEvent(
      canonicalWorkflowNodeStateEvent({
        workflowRunId: "workflow-1",
        nodeExecutionId: "node-1",
        nodeSessionId: "sub-session-1",
        authoritySessionId: "main-session-1",
        dialogProcessId: "runtime-node-dialog",
        turnScopeId: "turn-1",
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
        presentationMessageId: "authoritative-assistant-after-node-state",
        content: "done",
      }),
    ]);
    expect(child.workflowNodeState).toMatchObject({ sequence: 6 });
    expect(child.sequenceByScopeKey).toEqual({ "authoritative-assistant-after-node-state": 2 });
  });

  it("projects terminal workflow node state onto the isolated child session", () => {
    const store = useChatStore();
    store.applyWorkflowRuntimeEvent(
      canonicalWorkflowNodeStateEvent({
        workflowRunId: "workflow-1",
        nodeExecutionId: "node-1",
        nodeSessionId: "sub-session-1",
        authoritySessionId: "main-session-1",
        dialogProcessId: "dialog-1",
        turnScopeId: "turn-1",
        status: "running",
        eventId: "node-running",
        revision: 1,
        sequence: 1,
      }),
      { source: "test" },
    );
    applySessionSnapshot(store, {
      nodeSessionId: "sub-session-1",
      status: "running",
      messages: [
        {
          messageUid: "msg-user-request",
          userMessageId: "msg-user-request",
          role: "user",
          content: "request",
          turnScopeId: "turn-1",
        },
      ],
    });
    store.applyWorkflowRuntimeEvent(
      canonicalWorkflowNodeStateEvent({
        workflowRunId: "workflow-1",
        nodeExecutionId: "node-1",
        nodeSessionId: "sub-session-1",
        authoritySessionId: "main-session-1",
        dialogProcessId: "dialog-1",
        turnScopeId: "turn-1",
        status: "succeeded",
        eventId: "node-succeeded",
        revision: 2,
        sequence: 2,
      }),
      { source: "test" },
    );

    const session = store.selectSubSessionMessages("sub-session-1");
    expect(session.status).toBe("");
    expect(session.workflowNodeState).toMatchObject({ status: "succeeded" });
    expect(session.turnRuntime).toBeNull();
  });

  it("keeps multiple assistant turns and distinct tool calls separate during realtime projection", () => {
    const store = useChatStore();
    commitPresentation(store, { turnScopeId: "turn-1", presentationMessageId: "msg-1" });
    applyMessageEvent(
      store,
      createSubSessionEvent({
        eventId: "assistant-1",
        presentationMessageId: "msg-1",
        turnScopeId: "turn-1",
        sequence: 1,
        content: "first",
      }),
    );
    commitPresentation(store, { turnScopeId: "turn-2", presentationMessageId: "msg-2" });
    applyMessageEvent(
      store,
      createSubSessionEvent({
        eventId: "assistant-2",
        presentationMessageId: "msg-2",
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
        presentationMessageId: "msg-2",
        turnScopeId: "turn-2",
        sequence: 1,
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
        presentationMessageId: "msg-2",
        turnScopeId: "turn-2",
        sequence: 2,
        toolCallId: "call-2",
        tool: "two",
        content: "",
      }),
    );

    const messages = assistantMessages(store);
    expect(messages.map((message) => message.content)).toEqual(["first", "second"]);
    expect(messages[1].toolTimeline).toHaveLength(2);
    expect(messages[1].toolTimeline[1]).toMatchObject({ tool: "two" });

    expect(messages[1].messageEventState.consumedEventIds).toHaveLength(3);
    expect(store.selectSubSessionMessages("sub-session-1")?.sequenceByScopeKey).toMatchObject({
      "msg-1": 1,
      "msg-2": 3,
    });
  });
});
