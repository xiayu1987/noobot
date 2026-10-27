/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { requireFunctionDependencies } from "@noobot/shared/value";
import {
  lockChatMessageScrollSyncToAnchor,
  readMountedMessageListPanel,
} from "../runtime/chatMessageScrollSync.js";

export function buildChatMessageNavigatorOpenRoute({ sessionId, anchor, chatNavigatorPanel }) {
  return {
    sessionId,
    panel: chatNavigatorPanel,
    anchor,
  };
}

export function buildChatMessageNavigatorCloseRoute({ sessionId, anchor }) {
  return {
    sessionId,
    panel: "",
    anchor,
  };
}

export function selectChatMessageNavigatorItem({
  item,
  currentMessageAnchorId,
  messageListPanelRef,
  isMobile,
  mobileChatNavigatorVisible,
  activeSessionId,
  pushPseudoRoute,
}) {
  requireFunctionDependencies("selectChatMessageNavigatorItem", { pushPseudoRoute });
  const anchor = item.id;
  currentMessageAnchorId.value = anchor;
  const messageListPanel = readMountedMessageListPanel(messageListPanelRef);
  if (messageListPanel !== null) {
    lockChatMessageScrollSyncToAnchor(messageListPanel.getWrapRef(), anchor);
    messageListPanel.scrollToMessageAnchor(anchor);
  }
  if (isMobile.value) {
    mobileChatNavigatorVisible.value = false;
  }
  pushPseudoRoute(
    buildChatMessageNavigatorCloseRoute({
      sessionId: activeSessionId.value,
      anchor,
    }),
  );
}

export function openChatMessageNavigator({
  mobileChatNavigatorVisible,
  activeSessionId,
  currentMessageAnchorId,
  chatNavigatorPanel,
  pushPseudoRoute,
}) {
  requireFunctionDependencies("openChatMessageNavigator", { pushPseudoRoute });
  mobileChatNavigatorVisible.value = true;
  pushPseudoRoute(
    buildChatMessageNavigatorOpenRoute({
      sessionId: activeSessionId.value,
      anchor: currentMessageAnchorId.value,
      chatNavigatorPanel,
    }),
  );
}

export function closeChatMessageNavigator({
  activeSessionId,
  currentMessageAnchorId,
  replacePseudoRoute,
}) {
  requireFunctionDependencies("closeChatMessageNavigator", { replacePseudoRoute });
  replacePseudoRoute(
    buildChatMessageNavigatorCloseRoute({
      sessionId: activeSessionId.value,
      anchor: currentMessageAnchorId.value,
    }),
  );
}
