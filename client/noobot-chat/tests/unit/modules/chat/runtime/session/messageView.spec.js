/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { describe, expect, it } from "vitest";
import { ref } from "vue";
import { createSessionMessageView } from "../../../../../../src/modules/chat/runtime/session/messageView.js";
import { canonicalMessageEvent } from "../../helpers/messageEventFixture.js";

describe("session message view", () => {
  it("materializes one atomic Turn presentation idempotently", () => {
    const sessions = ref([{ sessionId: "session-1", messages: [] }]);
    const view = createSessionMessageView({
      sessions,
      activeSession: ref(sessions.value[0]),
      activeSessionId: ref("session-1"),
      userId: ref("admin"),
      isImageMime: () => false,
    });
    const presentation = canonicalMessageEvent({
      eventType: "turn_presentation_committed",
      messageId: "stream-1",
      presentationMessageId: "assistant-1",
      presentation: {
        userMessage: {
          id: "user-1",
          messageId: "user-1",
          role: "user",
          sessionId: "session-1",
          turnScopeId: "turn-1",
          content: "question",
          attachments: [],
        },
        assistantMessage: {
          id: "assistant-1",
          messageId: "assistant-1",
          presentationMessageId: "assistant-1",
          role: "assistant",
          sessionId: "session-1",
          turnScopeId: "turn-1",
          content: "",
          attachments: [],
        },
      },
    });

    expect(view.materializeTurnPresentation(presentation)).toEqual({
      applied: true,
      createdCount: 2,
    });
    expect(view.materializeTurnPresentation(presentation)).toEqual({
      applied: true,
      createdCount: 0,
    });
    expect(sessions.value[0].messages).toHaveLength(2);
    expect(sessions.value[0].messages.map(({ role, messageId }) => ({ role, messageId }))).toEqual([
      { role: "user", messageId: "user-1" },
      { role: "assistant", messageId: "assistant-1" },
    ]);
  });
  it("does not render internal control prompts as user messages", () => {
    const activeSession = { value: { sessionId: "session-1", messages: [] } };
    const view = createSessionMessageView({
      sessions: { value: [] },
      activeSession,
      activeSessionId: { value: "session-1" },
      userId: { value: "admin" },
      isImageMime: () => false,
    });

    expect(
      view.shouldRenderMessageInChat({
        role: "user",
        type: "human",
        internalType: "noobot.help_tool_failure_prompt",
        content: "工具调用已连续失败 3 次。",
      }),
    ).toBe(false);
    expect(
      view.shouldRenderMessageInChat({
        role: "user",
        type: "context_control",
        noobotInternalMessageType: "noobot.help_tool_failure_prompt",
        content: "工具调用已连续失败 3 次。",
      }),
    ).toBe(false);
    expect(
      view.shouldRenderMessageInChat({
        role: "user",
        type: "message",
        content: "真实用户消息",
      }),
    ).toBe(true);
  });
});
