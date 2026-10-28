/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { ref, watch } from "vue";
import { scrollToChatMessageNavigatorItem } from "../state/chatMessageNavigatorState.js";
import { resolveChatMessageNavTarget } from "../state/chatMessageNavItemsState.js";
import { selectSessionRuntimeBucket } from "../../modules/chat/runtime/run-state-machine/turnRuntimeSelectors.js";
import { isCanonicalText } from "@noobot/shared/value";

export const EMPTY_ROUTED_TURN = Object.freeze({ sessionId: "", turnScopeId: "" });

export function createPendingMessageNavigation({
  activeSession,
  activeSessionId,
  messageListPanelRef,
  turnRuntimeRegistry,
  chatMessageNavItems,
  routedTurn,
  routedTurnScopeId,
  currentMessageAnchorId,
}) {
  const pendingNavigation = ref(null);

  function requestMessageNavigation({ sessionId, turnScopeId }) {
    if (!isCanonicalText(sessionId)) {
      throw new TypeError("requestMessageNavigation requires sessionId");
    }
    if (typeof turnScopeId !== "string") {
      throw new TypeError("requestMessageNavigation requires turnScopeId string");
    }
    pendingNavigation.value = { sessionId, turnScopeId };
  }

  function requestSessionNavigation(sessionId) {
    requestMessageNavigation({ sessionId, turnScopeId: "" });
  }

  function requestTurnNavigation({ sessionId, turnScopeId }) {
    if (!isCanonicalText(turnScopeId)) {
      throw new TypeError("requestTurnNavigation requires turnScopeId");
    }
    requestMessageNavigation({ sessionId, turnScopeId });
  }

  function resolveRunningTurnScopeId(sessionId) {
    const bucket = selectSessionRuntimeBucket(turnRuntimeRegistry.value, sessionId);
    return bucket === null ? "" : bucket.activeTurnScopeId;
  }

  function resolveNavigationItem(request) {
    const items = chatMessageNavItems.value;
    if (request.turnScopeId) return resolveChatMessageNavTarget(items, request.turnScopeId);
    if (routedTurnScopeId.value) {
      const routedItem = resolveChatMessageNavTarget(items, routedTurnScopeId.value);
      if (routedItem !== null) return routedItem;
    }
    const runningTurnScopeId = resolveRunningTurnScopeId(request.sessionId);
    if (runningTurnScopeId) {
      const runningItem = resolveChatMessageNavTarget(items, runningTurnScopeId);
      if (runningItem !== null) return runningItem;
    }
    return resolveChatMessageNavTarget(items, "");
  }

  function hasNavigatorItemForTurn(turnScopeId) {
    return resolveChatMessageNavTarget(chatMessageNavItems.value, turnScopeId) !== null;
  }

  function dropStaleRoutedTurn() {
    if (!routedTurnScopeId.value) return;
    if (!hasNavigatorItemForTurn(routedTurnScopeId.value)) {
      routedTurn.value = EMPTY_ROUTED_TURN;
    }
  }

  function settlePendingNavigation() {
    const request = pendingNavigation.value;
    if (request === null) return;
    if (request.sessionId !== activeSessionId.value) {
      pendingNavigation.value = null;
      return;
    }
    const messageListPanel = messageListPanelRef.value;
    if (messageListPanel === null || activeSession.value === null) return;
    if (activeSession.value.loaded !== true) return;

    if (request.turnScopeId && !hasNavigatorItemForTurn(request.turnScopeId)) return;
    pendingNavigation.value = null;
    if (!request.turnScopeId) dropStaleRoutedTurn();
    const item = resolveNavigationItem(request);
    if (item === null) return;
    scrollToChatMessageNavigatorItem({ item, currentMessageAnchorId, messageListPanel });
  }

  watch(
    [
      pendingNavigation,
      activeSessionId,
      () => activeSession.value?.loaded,
      messageListPanelRef,
      chatMessageNavItems,
    ],
    settlePendingNavigation,
    { flush: "post" },
  );

  return { requestSessionNavigation, requestTurnNavigation };
}
