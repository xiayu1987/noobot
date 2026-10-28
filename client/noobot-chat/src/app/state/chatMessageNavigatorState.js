/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { requireFunctionDependencies } from "@noobot/shared/value";
import { lockChatMessageScrollSyncToAnchor } from "../runtime/chatMessageScrollSync.js";

export function buildChatMessageNavigatorOpenRoute({ sessionId, turn, chatNavigatorPanel }) {
  return {
    sessionId,
    panel: chatNavigatorPanel,
    turn,
  };
}

export function buildChatMessageNavigatorCloseRoute({ sessionId, turn }) {
  return {
    sessionId,
    panel: "",
    turn,
  };
}

export function scrollToChatMessageNavigatorItem({
  item,
  currentMessageAnchorId,
  messageListPanel,
}) {
  currentMessageAnchorId.value = item.id;
  lockChatMessageScrollSyncToAnchor(messageListPanel.getWrapRef(), item.id);
  messageListPanel.scrollToMessageAnchor(item.id);
}

export function selectChatMessageNavigatorItem({
  item,
  currentMessageAnchorId,
  messageListPanel,
  isMobile,
  mobileChatNavigatorVisible,
  activeSessionId,
  pushPseudoRoute,
}) {
  requireFunctionDependencies("selectChatMessageNavigatorItem", { pushPseudoRoute });
  scrollToChatMessageNavigatorItem({ item, currentMessageAnchorId, messageListPanel });
  if (isMobile.value) {
    mobileChatNavigatorVisible.value = false;
  }
  pushPseudoRoute(
    buildChatMessageNavigatorCloseRoute({
      sessionId: activeSessionId.value,
      turn: item.turnScopeId,
    }),
  );
}

export function openChatMessageNavigator({
  mobileChatNavigatorVisible,
  activeSessionId,
  routedTurnScopeId,
  chatNavigatorPanel,
  pushPseudoRoute,
}) {
  requireFunctionDependencies("openChatMessageNavigator", { pushPseudoRoute });
  mobileChatNavigatorVisible.value = true;
  pushPseudoRoute(
    buildChatMessageNavigatorOpenRoute({
      sessionId: activeSessionId.value,
      turn: routedTurnScopeId.value,
      chatNavigatorPanel,
    }),
  );
}

export function closeChatMessageNavigator({
  activeSessionId,
  routedTurnScopeId,
  replacePseudoRoute,
}) {
  requireFunctionDependencies("closeChatMessageNavigator", { replacePseudoRoute });
  replacePseudoRoute(
    buildChatMessageNavigatorCloseRoute({
      sessionId: activeSessionId.value,
      turn: routedTurnScopeId.value,
    }),
  );
}
