/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { describe, expect, it, vi } from "vitest";
import {
  buildChatMessageNavigatorCloseRoute,
  buildChatMessageNavigatorOpenRoute,
  openChatMessageNavigator,
  selectChatMessageNavigatorItem,
} from "../../../src/app/state/chatMessageNavigatorState.js";

function ref(value) {
  return { value };
}

describe("chatMessageNavigatorState", () => {
  it("builds pseudo routes for opening and closing the mobile navigator", () => {
    expect(
      buildChatMessageNavigatorOpenRoute({
        sessionId: "session-1",
        anchor: "chat-message-1",
        chatNavigatorPanel: "chatNavigator",
      }),
    ).toEqual({
      sessionId: "session-1",
      panel: "chatNavigator",
      anchor: "chat-message-1",
    });

    expect(
      buildChatMessageNavigatorCloseRoute({
        sessionId: "session-1",
        anchor: "chat-message-1",
      }),
    ).toEqual({
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
      item: { id: "chat-message-3" },
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

  it("selects the last navigator item anchor and pushes its pseudo route", () => {
    const navItems = [{ id: "chat-message-1" }, { id: "chat-message-2" }, { id: "chat-message-5" }];
    const scrollToMessageAnchor = vi.fn();
    const pushPseudoRoute = vi.fn();

    selectChatMessageNavigatorItem({
      item: navItems[navItems.length - 1],
      currentMessageAnchorId: ref(""),
      messageListPanelRef: ref({ getWrapRef: vi.fn(() => ({})), scrollToMessageAnchor }),
      isMobile: ref(false),
      mobileChatNavigatorVisible: ref(false),
      activeSessionId: ref("session-last"),
      pushPseudoRoute,
    });

    expect(scrollToMessageAnchor).toHaveBeenCalledWith("chat-message-5");
    expect(pushPseudoRoute).toHaveBeenCalledWith({
      sessionId: "session-last",
      panel: "",
      anchor: "chat-message-5",
    });
  });

  it("records the anchor and pushes the route without scrolling when the message list is unmounted", () => {
    const currentMessageAnchorId = ref("previous-anchor");
    const pushPseudoRoute = vi.fn();

    selectChatMessageNavigatorItem({
      item: { id: "chat-message-7" },
      currentMessageAnchorId,
      messageListPanelRef: ref(null),
      isMobile: ref(false),
      mobileChatNavigatorVisible: ref(false),
      activeSessionId: ref("session-unmounted"),
      pushPseudoRoute,
    });

    expect(currentMessageAnchorId.value).toBe("chat-message-7");
    expect(pushPseudoRoute).toHaveBeenCalledWith({
      sessionId: "session-unmounted",
      panel: "",
      anchor: "chat-message-7",
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
