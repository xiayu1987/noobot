import { describe, expect, it, vi } from "vitest";
import {
  buildChatMessageNavItem,
  buildChatMessageNavItems,
  normalizeChatMessageNavContent,
  resolveChatMessageNavRoleLabel,
} from "../../../src/app/state/chatMessageNavItemsState";

describe("chatMessageNavItemsState", () => {
  it("normalizes message content from content, text, whitespace, and missing values", () => {
    expect(normalizeChatMessageNavContent({ content: " hello\n  world " })).toBe("hello world");
    expect(normalizeChatMessageNavContent({ text: " fallback\ttext " })).toBe("fallback text");
    expect(normalizeChatMessageNavContent({ content: "", text: "backup" })).toBe("backup");
    expect(normalizeChatMessageNavContent(null)).toBe("");
  });

  it("builds a navigator item with stable anchor fallback, translated role fallback, and truncated content", () => {
    const message = {
      role: " assistant ",
      content: "abcdefghijklmnopqrstuvwxyz0123456789",
    };

    expect(buildChatMessageNavItem({
      messageItem: message,
      messageIndex: 2,
      getMessageAnchorId: () => "chat-message-assistant-2",
      translateSession: () => "Session",
      translateRole: (role) => (role === "assistant" ? "AI" : ""),
    })).toEqual({
      id: "chat-message-assistant-2",
      role: "assistant",
      roleLabel: "AI",
      content: "abcdefghijklmnopqrstuvwxyz0123456789",
      preview: "abcdefghijklmnopqrstuvwxyz01",
      title: "3. AI：abcdefghijklmnopqrstuvwxyz0123456789",
    });

    expect(buildChatMessageNavItem({
      messageItem: { content: "hello" },
      messageIndex: 0,
      getMessageAnchorId: () => "",
      translateSession: () => "Session",
    })).toEqual({
      id: "chat-message-0",
      role: "",
      roleLabel: "Session",
      content: "hello",
      preview: "hello",
      title: "1. Session：hello",
    });
  });

  it("builds items only for renderable messages and delegates anchor creation", () => {
    const shouldRenderMessageInChat = vi.fn((message) => message.role !== "system");
    const getMessageAnchorId = vi.fn((message, index) => `anchor-${message.role}-${index}`);

    expect(buildChatMessageNavItems({
      messages: [
        { role: "user", content: "hello" },
        { role: "system", content: "hidden" },
        { role: "assistant", text: "answer" },
      ],
      shouldRenderMessageInChat,
      getMessageAnchorId,
      translateSession: () => "Session",
      translateRole: (role) => ({ user: "我", assistant: "AI" })[role] || "",
    })).toEqual([
      {
        id: "anchor-user-0",
        role: "user",
        roleLabel: "ME",
        content: "hello",
        preview: "hello",
        title: "1. ME：hello",
      },
      {
        id: "anchor-assistant-2",
        role: "assistant",
        roleLabel: "AI",
        content: "answer",
        preview: "answer",
        title: "3. AI：answer",
      },
    ]);

    expect(shouldRenderMessageInChat).toHaveBeenCalledTimes(3);
    expect(getMessageAnchorId).toHaveBeenCalledTimes(2);
    expect(getMessageAnchorId).toHaveBeenNthCalledWith(1, { role: "user", content: "hello" }, 0);
    expect(getMessageAnchorId).toHaveBeenNthCalledWith(2, { role: "assistant", text: "answer" }, 2);
  });

  it("tolerates non-array message sources and missing callbacks", () => {
    expect(buildChatMessageNavItems({ messages: null })).toEqual([]);
    expect(buildChatMessageNavItems({
      messages: [{ role: "", content: "hello" }],
      shouldRenderMessageInChat: null,
      getMessageAnchorId: null,
      translateSession: null,
    })).toEqual([{
      id: "chat-message-0",
      role: "",
      roleLabel: "session",
      content: "hello",
      preview: "hello",
      title: "1. session：hello",
    }]);
  });

  it("resolves visible user and assistant role labels for navigator items", () => {
    expect(resolveChatMessageNavRoleLabel("user")).toBe("ME");
    expect(resolveChatMessageNavRoleLabel("assistant")).toBe("AI");
    expect(resolveChatMessageNavRoleLabel("user", {
      translateRole: (role) => (role === "user" ? "我" : ""),
    })).toBe("ME");
  });
});
