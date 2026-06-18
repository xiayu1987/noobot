export function normalizeChatMessageNavigatorAnchor(item = {}) {
  return String(item?.id || "").trim();
}

export function buildChatMessageNavigatorOpenRoute({
  sessionId = "",
  anchor = "",
  chatNavigatorPanel = "",
} = {}) {
  return {
    sessionId,
    panel: chatNavigatorPanel,
    anchor,
  };
}

export function buildChatMessageNavigatorCloseRoute({
  sessionId = "",
  anchor = "",
} = {}) {
  return {
    sessionId,
    panel: "",
    anchor,
  };
}

export function selectChatMessageNavigatorItem({
  item = {},
  currentMessageAnchorId,
  messageListPanelRef,
  isMobile,
  mobileChatNavigatorVisible,
  activeSessionId,
  pushPseudoRoute,
} = {}) {
  const anchor = normalizeChatMessageNavigatorAnchor(item);
  currentMessageAnchorId.value = anchor;
  messageListPanelRef.value?.scrollToMessageAnchor?.(anchor);
  if (isMobile.value) {
    mobileChatNavigatorVisible.value = false;
  }
  pushPseudoRoute(buildChatMessageNavigatorCloseRoute({
    sessionId: activeSessionId.value,
    anchor,
  }));
}

export function openChatMessageNavigator({
  mobileChatNavigatorVisible,
  activeSessionId,
  currentMessageAnchorId,
  chatNavigatorPanel,
  pushPseudoRoute,
} = {}) {
  mobileChatNavigatorVisible.value = true;
  pushPseudoRoute(buildChatMessageNavigatorOpenRoute({
    sessionId: activeSessionId.value,
    panel: chatNavigatorPanel,
    anchor: currentMessageAnchorId.value,
    chatNavigatorPanel,
  }));
}

export function closeChatMessageNavigator({
  activeSessionId,
  currentMessageAnchorId,
  replacePseudoRoute,
} = {}) {
  replacePseudoRoute(buildChatMessageNavigatorCloseRoute({
    sessionId: activeSessionId.value,
    anchor: currentMessageAnchorId.value,
  }));
}
