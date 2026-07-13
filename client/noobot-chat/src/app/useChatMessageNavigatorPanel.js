/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { computed, nextTick, ref, watch } from "vue";
import { createChatMessageScrollSync } from "./chatMessageScrollSync";
import {
  closeChatMessageNavigator,
  openChatMessageNavigator as openChatMessageNavigatorState,
  selectChatMessageNavigatorItem,
} from "./state/chatMessageNavigatorState";
import { buildChatMessageNavItems } from "./state/chatMessageNavItemsState";

export function useChatMessageNavigatorPanel({
  activeSession,
  activeSessionId,
  shouldRenderMessageInChat,
  messageListPanelRef,
  isMobile,
  translate,
  chatNavigatorPanel,
  pushPseudoRoute,
  replacePseudoRoute,
} = {}) {
  const chatNavigatorVisible = ref(true);
  const mobileChatNavigatorVisible = ref(false);
  const currentMessageAnchorId = ref("");

  const chatMessageNavItems = computed(() => buildChatMessageNavItems({
    messages: activeSession?.value?.messages || [],
    shouldRenderMessageInChat,
    getMessageAnchorId: messageListPanelRef?.value?.getMessageAnchorId,
    translateSession: () => translate?.("common.session") || "session",
    translateRole: (role) => {
      if (role === "user") return "ME";
      if (role === "assistant") return translate?.("message.ai") || "AI";
      if (role === "tool") return translate?.("message.tool") || "Tool";
      return "";
    },
  }));

  function handleSelectChatMessageNavItem(item = {}) {
    selectChatMessageNavigatorItem({
      item,
      currentMessageAnchorId,
      messageListPanelRef,
      isMobile,
      mobileChatNavigatorVisible,
      activeSessionId,
      pushPseudoRoute,
    });
  }

  function navigateToLastMessage() {
    nextTick(() => {
      const items = Array.isArray(chatMessageNavItems.value) ? chatMessageNavItems.value : [];
      const lastItem = items[items.length - 1] || null;
      if (!String(lastItem?.id || "").trim()) return;
      handleSelectChatMessageNavItem(lastItem);
    });
  }

  function locateSendingStartedMessage() {
    navigateToLastMessage();
  }

  function locateDoneMessage() {
    navigateToLastMessage();
  }

  function openChatMessageNavigator() {
    openChatMessageNavigatorState({
      mobileChatNavigatorVisible,
      activeSessionId,
      currentMessageAnchorId,
      chatNavigatorPanel,
      pushPseudoRoute,
    });
  }

  function handleMobileChatNavigatorClosed() {
    closeChatMessageNavigator({
      activeSessionId,
      currentMessageAnchorId,
      replacePseudoRoute,
    });
  }

  const {
    bindChatMessageScrollSync,
    unbindChatMessageScrollSync,
  } = createChatMessageScrollSync({
    currentMessageAnchorId,
    messageListPanelRef,
  });

  watch(
    chatMessageNavItems,
    () => {
      nextTick(bindChatMessageScrollSync);
    },
    { flush: "post", immediate: true },
  );

  watch(
    () => activeSessionId?.value,
    () => {
      currentMessageAnchorId.value = "";
      nextTick(bindChatMessageScrollSync);
    },
  );

  return {
    chatNavigatorVisible,
    mobileChatNavigatorVisible,
    currentMessageAnchorId,
    chatMessageNavItems,
    handleSelectChatMessageNavItem,
    navigateToLastMessage,
    locateLastChatMessageNavItem: navigateToLastMessage,
    locateSendingStartedMessage,
    locateDoneMessage,
    openChatMessageNavigator,
    handleMobileChatNavigatorClosed,
    bindChatMessageScrollSync,
    unbindChatMessageScrollSync,
  };
}
