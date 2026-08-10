/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { describe, expect, it } from "vitest";
import { createSessionMessageView } from "../../../../../../src/modules/chat/runtime/session/messageView.js";

describe("session message view", () => {
  it("does not render internal control prompts as user messages", () => {
    const activeSession = { value: { sessionId: "session-1", messages: [] } };
    const view = createSessionMessageView({
      sessions: { value: [] },
      activeSession,
      activeSessionId: { value: "session-1" },
      userId: { value: "admin" },
      isImageMime: () => false,
    });

    expect(view.shouldRenderMessageInChat({
      role: "user",
      type: "human",
      internalType: "noobot.help_tool_failure_prompt",
      content: "工具调用已连续失败 3 次。",
    })).toBe(false);
    expect(view.shouldRenderMessageInChat({
      role: "user",
      type: "context_control",
      noobotInternalMessageType: "noobot.help_tool_failure_prompt",
      content: "工具调用已连续失败 3 次。",
    })).toBe(false);
    expect(view.shouldRenderMessageInChat({
      role: "user",
      type: "message",
      content: "真实用户消息",
    })).toBe(true);
  });
});
