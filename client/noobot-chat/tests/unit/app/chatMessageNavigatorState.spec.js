/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { describe, expect, it, vi } from "vitest";
import {
  buildChatMessageNavigatorCloseRoute,
  buildChatMessageNavigatorOpenRoute,
  closeChatMessageNavigator,
  openChatMessageNavigator,
  scrollToChatMessageNavigatorItem,
  selectChatMessageNavigatorItem,
} from "../../../src/app/state/chatMessageNavigatorState.js";

function ref(value) {
  return { value };
}

const TURN = "client-turn:00000000-0000-4000-8000-000000000003";

function createMessageListPanel() {
  const wrapRef = {};
  return { wrapRef, getWrapRef: vi.fn(() => wrapRef), scrollToMessageAnchor: vi.fn() };
}

describe("chatMessageNavigatorState", () => {
  it("builds pseudo routes carrying the routed turn", () => {
    expect(
      buildChatMessageNavigatorOpenRoute({
        sessionId: "session-1",
        turn: TURN,
        chatNavigatorPanel: "chatNavigator",
      }),
    ).toEqual({ sessionId: "session-1", panel: "chatNavigator", turn: TURN });
    expect(buildChatMessageNavigatorCloseRoute({ sessionId: "session-1", turn: TURN })).toEqual({
      sessionId: "session-1",
      panel: "",
      turn: TURN,
    });
  });

  it("scrolls to an item without writing the pseudo route", () => {
    const panel = createMessageListPanel();
    const currentMessageAnchorId = ref("");

    scrollToChatMessageNavigatorItem({
      item: { id: "chat-message-3", turnScopeId: TURN },
      currentMessageAnchorId,
      messageListPanel: panel,
    });

    expect(currentMessageAnchorId.value).toBe("chat-message-3");
    expect(panel.getWrapRef).toHaveBeenCalledBefore(panel.scrollToMessageAnchor);
    expect(panel.wrapRef.__noobotChatNavPendingAnchor).toMatchObject({ anchor: "chat-message-3" });
    expect(panel.scrollToMessageAnchor).toHaveBeenCalledWith("chat-message-3");
  });

  it("user selection scrolls, closes the mobile drawer and pushes the item turn", () => {
    const panel = createMessageListPanel();
    const mobileChatNavigatorVisible = ref(true);
    const pushPseudoRoute = vi.fn();

    selectChatMessageNavigatorItem({
      item: { id: "chat-message-3", turnScopeId: TURN },
      currentMessageAnchorId: ref(""),
      messageListPanel: panel,
      isMobile: ref(true),
      mobileChatNavigatorVisible,
      activeSessionId: ref("session-2"),
      pushPseudoRoute,
    });

    expect(panel.scrollToMessageAnchor).toHaveBeenCalledWith("chat-message-3");
    expect(mobileChatNavigatorVisible.value).toBe(false);
    expect(pushPseudoRoute).toHaveBeenCalledWith({ sessionId: "session-2", panel: "", turn: TURN });
  });

  it("opens and closes the mobile navigator keeping the routed turn", () => {
    const mobileChatNavigatorVisible = ref(false);
    const pushPseudoRoute = vi.fn();
    const replacePseudoRoute = vi.fn();

    openChatMessageNavigator({
      mobileChatNavigatorVisible,
      activeSessionId: ref("session-3"),
      routedTurnScopeId: ref(TURN),
      chatNavigatorPanel: "chatNavigator",
      pushPseudoRoute,
    });
    closeChatMessageNavigator({
      activeSessionId: ref("session-3"),
      routedTurnScopeId: ref(TURN),
      replacePseudoRoute,
    });

    expect(mobileChatNavigatorVisible.value).toBe(true);
    expect(pushPseudoRoute).toHaveBeenCalledWith({
      sessionId: "session-3",
      panel: "chatNavigator",
      turn: TURN,
    });
    expect(replacePseudoRoute).toHaveBeenCalledWith({
      sessionId: "session-3",
      panel: "",
      turn: TURN,
    });
  });
});
