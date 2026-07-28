/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { beforeEach, describe, expect, it } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import {
  beginAssistantMessageEventStream,
  emitMessageEvent,
} from "../../../../../../../../agent/src/events/message-event-stream.js";
import { createRunEventListener } from "../../../../../../../../service/ws/chat-websocket/run-event-listener.js";
import { shouldProjectSubSessionEvent } from "../../../../../../src/modules/chat/runtime/engine/sendFlow.js";
import { useChatStore } from "../../../../../../src/modules/chat/stores/useChatStore.js";

function deliverPacketToStore(store, frame) {
  const wireFrame = JSON.parse(JSON.stringify(frame));
  expect(shouldProjectSubSessionEvent(wireFrame.event, wireFrame.data)).toBe(true);
  return store.upsertSubSessionEvent(
    wireFrame.data.event.eventType,
    wireFrame.data.event,
  );
}

describe("authoritative message event end-to-end fidelity", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it("preserves Mermaid thinking through tool results and snapshot takeover", () => {
    const store = useChatStore();
    const frames = [];
    const produced = [];
    const runtime = {
      sessionId: "child-session",
      systemRuntime: {
        sessionId: "child-session",
        dialogProcessId: "child-dialog",
        turnScopeId: "child-turn",
      },
    };
    const listener = createRunEventListener({
      sessionId: "parent-session",
      textStreamingEnabled: true,
      sendEvent(event, data) {
        frames.push({ event, data });
      },
    });

    const messageId = beginAssistantMessageEventStream(runtime, { turn: 1 });
    produced.push(emitMessageEvent(listener, runtime, "main_model_content", {
      sessionId: "child-session",
      parentSessionId: "parent-session",
      dialogProcessId: "child-dialog",
      turnScopeId: "child-turn",
      text: "```mermaid\ngraph TD; A-->B\n```",
      output: "```mermaid\ngraph TD; A-->B\n```",
      thinking: "```mermaid\ngraph TD; A-->B\n```",
    }));
    produced.push(emitMessageEvent(listener, runtime, "tool_call_end", {
      sessionId: "child-session",
      parentSessionId: "parent-session",
      dialogProcessId: "child-dialog",
      turnScopeId: "child-turn",
      toolCallId: "call-1",
      toolResult: { tool_call_id: "call-1", output: "ok" },
    }));

    expect(frames).toHaveLength(2);
    frames.forEach((frame, index) => {
      expect(frame.event).toBe("subagent_message_event");
      expect(frame.data.event).toEqual(produced[index]);
      expect(frame.data.event.sequenceScopeId).toBe(messageId);
      expect(frame.data.route).not.toHaveProperty("messageId");
      expect(deliverPacketToStore(store, frame).applied).toBe(true);
    });

    let session = store.selectSubSessionMessages("child-session");
    expect(session.messages).toHaveLength(1);
    expect(session.messages[0]).toMatchObject({
      id: messageId,
      messageId,
      role: "assistant",
      thinking: "```mermaid\ngraph TD; A-->B\n```",
      toolResult: { tool_call_id: "call-1", output: "ok" },
    });

    store.mergeSubSessionSnapshot({
      id: "child-session",
      messages: [{
        id: messageId,
        messageId,
        role: "assistant",
        content: "final answer",
      }],
    });
    session = store.selectSubSessionMessages("child-session");
    expect(session.messages).toHaveLength(1);
    expect(session.messages[0]).toMatchObject({
      id: messageId,
      content: "final answer",
      thinking: "```mermaid\ngraph TD; A-->B\n```",
      toolResult: { tool_call_id: "call-1", output: "ok" },
    });
    expect(session.messages[0].rawEvents).toHaveLength(2);
  });
});
