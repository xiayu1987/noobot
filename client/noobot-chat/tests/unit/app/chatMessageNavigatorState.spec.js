import { describe, expect, it, vi } from "vitest";
import {
  buildChatMessageNavigatorCloseRoute,
  buildChatMessageNavigatorOpenRoute,
  normalizeChatMessageNavigatorAnchor,
  openChatMessageNavigator,
  selectChatMessageNavigatorItem,
} from "../../../src/app/state/chatMessageNavigatorState";

function ref(value) {
  return { value };
}

describe("chatMessageNavigatorState", () => {
  it("normalizes selected navigator item anchors", () => {
    expect(normalizeChatMessageNavigatorAnchor({ id: "  chat-message-2  " })).toBe("chat-message-2");
    expect(normalizeChatMessageNavigatorAnchor({ id: 42 })).toBe("42");
    expect(normalizeChatMessageNavigatorAnchor(null)).toBe("");
  });

  it("builds pseudo routes for opening and closing the mobile navigator", () => {
    expect(buildChatMessageNavigatorOpenRoute({
      sessionId: "session-1",
      anchor: "chat-message-1",
      chatNavigatorPanel: "chatNavigator",
    })).toEqual({
      sessionId: "session-1",
      panel: "chatNavigator",
      anchor: "chat-message-1",
    });

    expect(buildChatMessageNavigatorCloseRoute({
      sessionId: "session-1",
      anchor: "chat-message-1",
    })).toEqual({
      sessionId: "session-1",
      panel: "",
      anchor: "chat-message-1",
    });
  });

  it("selects a navigator item, scrolls the message list, closes mobile drawer, and pushes route", () => {
    const currentMessageAnchorId = ref("");
    const mobileChatNavigatorVisible = ref(true);
    const scrollToMessageAnchor = vi.fn();
    const wrapRef = {};
    const getWrapRef = vi.fn(() => wrapRef);
    const pushPseudoRoute = vi.fn();

    selectChatMessageNavigatorItem({
      item: { id: " chat-message-3 " },
      currentMessageAnchorId,
      messageListPanelRef: ref({ getWrapRef, scrollToMessageAnchor }),
      isMobile: ref(true),
      mobileChatNavigatorVisible,
      activeSessionId: ref("session-2"),
      pushPseudoRoute,
    });

    expect(currentMessageAnchorId.value).toBe("chat-message-3");
    expect(getWrapRef).toHaveBeenCalledBefore(scrollToMessageAnchor);
    expect(wrapRef.__noobotChatNavPendingAnchor).toMatchObject({ anchor: "chat-message-3" });
    expect(scrollToMessageAnchor).toHaveBeenCalledWith("chat-message-3");
    expect(mobileChatNavigatorVisible.value).toBe(false);
    expect(pushPseudoRoute).toHaveBeenCalledWith({
      sessionId: "session-2",
      panel: "",
      anchor: "chat-message-3",
    });
  });

  it("opens mobile navigator and keeps the current anchor in the pseudo route", () => {
    const mobileChatNavigatorVisible = ref(false);
    const pushPseudoRoute = vi.fn();

    openChatMessageNavigator({
      mobileChatNavigatorVisible,
      activeSessionId: ref("session-3"),
      currentMessageAnchorId: ref("chat-message-4"),
      chatNavigatorPanel: "chatNavigator",
      pushPseudoRoute,
    });

    expect(mobileChatNavigatorVisible.value).toBe(true);
    expect(pushPseudoRoute).toHaveBeenCalledWith({
      sessionId: "session-3",
      panel: "chatNavigator",
      anchor: "chat-message-4",
    });
  });
});
