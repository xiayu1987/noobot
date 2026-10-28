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
import { createPendingMessageNavigation, EMPTY_ROUTED_TURN } from "./pendingMessageNavigation.js";
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

  const routedTurn = ref(EMPTY_ROUTED_TURN);
  const routedTurnScopeId = computed(() =>
    routedTurn.value.sessionId === activeSessionId.value ? routedTurn.value.turnScopeId : "",
  );

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
    const messageListPanel = messageListPanelRef.value;
    if (messageListPanel === null) {
      throw new Error("chat message navigator item selected before message list mounted");
    }
    routedTurn.value = { sessionId: activeSessionId.value, turnScopeId: item.turnScopeId };
    selectChatMessageNavigatorItem({
      item,
      currentMessageAnchorId,
      messageListPanel,
      isMobile,
      mobileChatNavigatorVisible,
      activeSessionId,
      pushPseudoRoute,
    });
  }

  const { requestSessionNavigation, requestTurnNavigation } = createPendingMessageNavigation({
    activeSession,
    activeSessionId,
    messageListPanelRef,
    turnRuntimeRegistry,
    chatMessageNavItems,
    routedTurn,
    routedTurnScopeId,
    currentMessageAnchorId,
  });

  function applyRoutedTurn({ sessionId, turnScopeId }) {
    routedTurn.value = turnScopeId ? { sessionId, turnScopeId } : EMPTY_ROUTED_TURN;
  }

  function openChatMessageNavigator() {
    openChatMessageNavigatorState({
      mobileChatNavigatorVisible,
      activeSessionId,
      routedTurnScopeId,
      chatNavigatorPanel,
      pushPseudoRoute,
    });
  }

  function handleMobileChatNavigatorClosed() {
    closeChatMessageNavigator({
      activeSessionId,
      routedTurnScopeId,
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
    (sessionId) => {
      currentMessageAnchorId.value = "";
      if (sessionId) requestSessionNavigation(sessionId);
      nextTick(bindChatMessageScrollSync);
    },
  );

  return {
    chatNavigatorVisible,
    mobileChatNavigatorVisible,
    currentMessageAnchorId,
    routedTurnScopeId,
    chatMessageNavItems,
    handleSelectChatMessageNavItem,
    requestSessionNavigation,
    requestTurnNavigation,
    applyRoutedTurn,
    openChatMessageNavigator,
    handleMobileChatNavigatorClosed,
    bindChatMessageScrollSync,
    unbindChatMessageScrollSync,
  };
}
