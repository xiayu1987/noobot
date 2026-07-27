/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { describe, expect, it } from "vitest";
import {
  applyFoldedMessagesForDialogProcess,
  applyFoldedMessagesToActiveSession,
} from "../../../../src/composables/chat/reconnectReplay/messageReplay.js";
import { resolveReconnectTargetAssistantMessage } from "../../../../src/composables/chat/reconnectReplay/assistantMessageReplay.js";
import { selectToolTimeline } from "../../../../src/composables/chat/chatEngine/toolTimeline.js";

describe("messageReplay", () => {
  it("promotes a dialog-only reconnect assistant when the authoritative turn scope arrives", () => {
    const assistant = {
      role: "assistant",
      content: "",
      pending: true,
      turnPlaceholder: true,
      dialogProcessId: "dp-workflow",
    };
    const activeSession = { value: { id: "session-1", messages: [assistant] } };
    const appendMessage = (role, content) => {
      const message = { role, content };
      activeSession.value.messages.push(message);
      return message;
    };

    const resolved = resolveReconnectTargetAssistantMessage({
      activeSession,
      appendMessage,
      dialogProcessId: "dp-workflow",
      turnScopeId: "client-turn:workflow-1",
    });

    expect(resolved).toBe(assistant);
    expect(assistant.turnScopeId).toBe("client-turn:workflow-1");
    expect(activeSession.value.messages).toHaveLength(1);
  });

  it("patches an existing pending assistant for a reconnect DONE dialog process", () => {
    const pendingAssistant = {
      role: "assistant",
      pending: true,
      dialogProcessId: "dp-1",
      turnScopeId: "turn-1",
      content: "",
      attachments: [],
    };
    const activeSession = {
      value: {
        messages: [
          { role: "user", content: "question", turnScopeId: "turn-1" },
          pendingAssistant,
        ],
      },
    };

    const result = applyFoldedMessagesForDialogProcess(
      activeSession,
      [
        {
          role: "assistant",
          pending: false,
          dialogProcessId: "dp-1",
          turnScopeId: "turn-1",
          content: "final answer",
          attachments: [{ fileName: "answer.txt", url: "/answer.txt" }],
        },
      ],
      "dp-1",
    );

    expect(result).toBe(activeSession.value.messages);
    expect(activeSession.value.messages).toHaveLength(2);
    expect(activeSession.value.messages[1]).toBe(pendingAssistant);
    expect(activeSession.value.messages[1]).toMatchObject({
      pending: false,
      dialogProcessId: "dp-1",
      turnScopeId: "turn-1",
      content: "final answer",
      attachments: [{ fileName: "answer.txt", url: "/answer.txt" }],
    });
  });

  it("does not append missing finalized reconnect DONE assistants as a second completed-message source", () => {
    const activeSession = {
      value: {
        messages: [
          { role: "user", content: "existing question", turnScopeId: "turn-existing" },
          {
            role: "assistant",
            pending: true,
            dialogProcessId: "dp-in-flight",
            turnScopeId: "turn-in-flight",
            content: "",
          },
        ],
      },
    };

    applyFoldedMessagesForDialogProcess(
      activeSession,
      [
        {
          role: "assistant",
          pending: false,
          dialogProcessId: "dp-missing",
          turnScopeId: "turn-missing",
          content: "final answer from reconnect snapshot",
          attachments: [{ fileName: "snapshot.txt", url: "/snapshot.txt" }],
        },
      ],
      "dp-missing",
    );

    expect(activeSession.value.messages).toHaveLength(2);
    expect(activeSession.value.messages.some((messageItem) =>
      messageItem.dialogProcessId === "dp-missing" || messageItem.content === "final answer from reconnect snapshot",
    )).toBe(false);
  });

  it("can still replace the whole active session when no dialog process overlay is requested", () => {
    const activeSession = {
      value: {
        messages: [{ role: "assistant", pending: true, content: "old" }],
      },
    };

    applyFoldedMessagesToActiveSession(activeSession, [
      { role: "user", content: "question" },
      { role: "assistant", pending: false, content: "answer" },
    ]);

    expect(activeSession.value.messages.map((messageItem) => messageItem.content)).toEqual([
      "question",
      "answer",
    ]);
  });

  it("does not erase live tool events when an older reconnect snapshot patches an in-flight continuation", () => {
    const liveToolCall = { eventId: "event-tool-call", type: "tool_call", toolCallId: "call-1" };
    const liveToolResult = { eventId: "event-tool-result", type: "tool_result", toolCallId: "call-1" };
    const assistant = {
      role: "assistant",
      pending: true,
      dialogProcessId: "shared-dialog",
      turnScopeId: "continued-turn",
      toolTimeline: [{
        toolCallId: "call-1",
        call: liveToolCall,
        result: liveToolResult,
        callSequence: 11,
        resultSequence: 12,
      }],
      messageEventState: {
        lastSequence: 12,
        consumedEventIds: ["event-tool-call", "event-tool-result"],
      },
    };
    const activeSession = { value: { messages: [assistant], turnStatuses: [] } };

    applyFoldedMessagesForDialogProcess(activeSession, [{
      role: "assistant",
      pending: true,
      dialogProcessId: "shared-dialog",
      turnScopeId: "continued-turn",
      activityTimeline: [{ activityId: "event-thinking", eventId: "event-thinking", type: "thinking", sequence: 8 }],
      messageEventState: { lastSequence: 8, consumedEventIds: ["event-thinking"] },
    }], "shared-dialog");

    expect(activeSession.value.messages[0]).toBe(assistant);
    expect(selectToolTimeline(assistant)).toHaveLength(1);
    expect(selectToolTimeline(assistant)[0]).toMatchObject({ toolCallId: "call-1" });
    expect(assistant.activityTimeline || []).toEqual([]);
    expect(assistant.messageEventState.lastSequence).toBe(12);
    expect(assistant.messageEventState.consumedEventIds).toEqual([
      "event-tool-call",
      "event-tool-result",
    ]);
  });
});
