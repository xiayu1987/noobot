/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { computed, isRef, nextTick, ref, watch } from "vue";
import { createChatMessageScrollSync } from "../runtime/chatMessageScrollSync.js";
import {
  closeChatMessageNavigator,
  openChatMessageNavigator as openChatMessageNavigatorState,
  selectChatMessageNavigatorItem,
} from "../state/chatMessageNavigatorState.js";
import { buildChatMessageNavItems } from "../state/chatMessageNavItemsState.js";
import { selectTurnPresentations } from "../../modules/chat/runtime/engine/turnPresentation.js";
import { requireFunctionDependencies } from "@noobot/shared/value";

export function useChatMessageNavigatorPanel({
  activeSession,
  activeSessionId,
  workflowNodeStateRegistry,
  turnRuntimeRegistry,
  shouldRenderMessageInChat,
  messageListPanelRef,
  isMobile,
  translate,
  chatNavigatorPanel,
  pushPseudoRoute,
  replacePseudoRoute,
}) {
  requireFunctionDependencies("useChatMessageNavigatorPanel", {
    translate,
    shouldRenderMessageInChat,
    pushPseudoRoute,
    replacePseudoRoute,
  });
  if (!isRef(activeSession) || !isRef(activeSessionId)) {
    throw new TypeError(
      "useChatMessageNavigatorPanel requires activeSession and activeSessionId refs",
    );
  }
  const chatNavigatorVisible = ref(true);
  const mobileChatNavigatorVisible = ref(false);
  const currentMessageAnchorId = ref("");

  const chatMessageNavItems = computed(() => {
    const session = activeSession.value;
    if (session === null) return [];
    return buildChatMessageNavItems({
      messages: selectTurnPresentations({
        activeSession: session,
        workflowRegistry: workflowNodeStateRegistry.value,
        turnRuntimeRegistry: turnRuntimeRegistry.value,
      }),
      shouldRenderMessageInChat,
      translate,
    });
  });

  function handleSelectChatMessageNavItem(item) {
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
      const items = chatMessageNavItems.value;
      if (!items.length) return;
      handleSelectChatMessageNavItem(items[items.length - 1]);
    });
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

  const { bindChatMessageScrollSync, unbindChatMessageScrollSync } = createChatMessageScrollSync({
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
    () => activeSessionId.value,
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
    openChatMessageNavigator,
    handleMobileChatNavigatorClosed,
    bindChatMessageScrollSync,
    unbindChatMessageScrollSync,
  };
}
