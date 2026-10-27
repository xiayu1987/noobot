/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { describe, expect, it, vi } from "vitest";
import {
  buildChatMessageNavItem,
  buildChatMessageNavItems,
  normalizeChatMessageNavContent,
  resolveChatMessageNavRoleLabelKey,
} from "../../../src/app/state/chatMessageNavItemsState.js";
import { getMessageAnchorId } from "../../../src/modules/chat/model/messageAnchor.js";

const LABELS = Object.freeze({
  "message.me": "我",
  "message.ai": "AI",
  "message.tool": "工具",
  "common.session": "会话",
});

function translate(key) {
  if (!Object.hasOwn(LABELS, key)) throw new Error(`unexpected i18n key ${key}`);
  return LABELS[key];
}

describe("chatMessageNavItemsState", () => {
  it("collapses whitespace of string content and rejects non-string content", () => {
    expect(normalizeChatMessageNavContent({ content: " hello\n  world " })).toBe("hello world");
    expect(() => normalizeChatMessageNavContent({ text: "legacy" })).toThrow(
      "chat_message_nav_content_not_string",
    );
  });

  it("maps every role to a single i18n key", () => {
    expect(resolveChatMessageNavRoleLabelKey("user")).toBe("message.me");
    expect(resolveChatMessageNavRoleLabelKey("assistant")).toBe("message.ai");
    expect(resolveChatMessageNavRoleLabelKey("tool")).toBe("message.tool");
    expect(resolveChatMessageNavRoleLabelKey("system")).toBe("common.session");
  });

  it("builds an item whose id is the list panel anchor of the same message and index", () => {
    const message = {
      role: "assistant",
      sessionId: "session-1",
      turnScopeId: "client-turn:00000000-0000-4000-8000-000000000001",
      content: "abcdefghijklmnopqrstuvwxyz0123456789",
    };

    expect(buildChatMessageNavItem({ messageItem: message, messageIndex: 2, translate })).toEqual({
      id: getMessageAnchorId(message, 2),
      role: "assistant",
      roleLabel: "AI",
      content: "abcdefghijklmnopqrstuvwxyz0123456789",
      preview: "abcdefghijklmnopqrstuvwxyz01",
      title: "3. AI：abcdefghijklmnopqrstuvwxyz0123456789",
    });
  });

  it("keeps source indexes of renderable messages so anchors match the list panel", () => {
    const shouldRenderMessageInChat = vi.fn((message) => message.role !== "system");
    const messages = [
      { role: "user", content: "hello" },
      { role: "system", content: "hidden" },
      { role: "tool", content: "result" },
    ];

    const items = buildChatMessageNavItems({ messages, shouldRenderMessageInChat, translate });

    expect(items.map((item) => [item.id, item.roleLabel, item.title])).toEqual([
      [getMessageAnchorId(messages[0], 0), "我", "1. 我：hello"],
      [getMessageAnchorId(messages[2], 2), "工具", "3. 工具：result"],
    ]);
    expect(shouldRenderMessageInChat).toHaveBeenCalledTimes(3);
  });

  it("rejects missing dependencies and non-array message sources", () => {
    expect(() =>
      buildChatMessageNavItems({ messages: [], shouldRenderMessageInChat: () => true }),
    ).toThrow();
    expect(() =>
      buildChatMessageNavItems({
        messages: null,
        shouldRenderMessageInChat: () => true,
        translate,
      }),
    ).toThrow("chat_message_nav_messages_not_array");
    expect(() => getMessageAnchorId({ role: "user", content: "x" }, -1)).toThrow(
      "message_anchor_index_invalid",
    );
  });
});
