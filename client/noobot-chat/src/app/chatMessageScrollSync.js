/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { nowMs } from "../composables/infra/timeFields";
import { TIME_THRESHOLDS } from "@noobot/shared/time-thresholds";
const CHAT_MESSAGE_NAVIGATOR_SCROLL_LOCK_KEY = "__noobotChatNavPendingAnchor";
export const CHAT_MESSAGE_NAVIGATOR_SCROLL_LOCK_MS =
  TIME_THRESHOLDS.client.chatMessageNavigatorScrollLockMs;

function getAnchorId(anchor = {}) {
  return String(anchor?.dataset?.chatMessageAnchor || anchor?.id || "");
}

export function lockChatMessageScrollSyncToAnchor(wrapRef, anchor = "") {
  const normalizedAnchor = String(anchor || "").trim();
  if (!wrapRef || !normalizedAnchor) return;
  wrapRef[CHAT_MESSAGE_NAVIGATOR_SCROLL_LOCK_KEY] = {
    anchor: normalizedAnchor,
    expiresAt: nowMs() + CHAT_MESSAGE_NAVIGATOR_SCROLL_LOCK_MS,
  };
}

function shouldKeepNavigatorScrollLock(wrapRef, nextAnchorId = "") {
  const lock = wrapRef?.[CHAT_MESSAGE_NAVIGATOR_SCROLL_LOCK_KEY];
  if (!lock) return false;
  if (nowMs() > Number(lock.expiresAt || 0)) {
    delete wrapRef[CHAT_MESSAGE_NAVIGATOR_SCROLL_LOCK_KEY];
    return false;
  }
  if (String(nextAnchorId || "") === lock.anchor) {
    delete wrapRef[CHAT_MESSAGE_NAVIGATOR_SCROLL_LOCK_KEY];
    return false;
  }
  return true;
}

export function createChatMessageScrollSync({ currentMessageAnchorId, messageListPanelRef }) {
  function syncCurrentMessageAnchorId() {
    const wrapRef = messageListPanelRef.value?.getWrapRef?.();
    if (!wrapRef) return;
    const anchors = Array.from(wrapRef.querySelectorAll?.("[data-chat-message-anchor]") || []);
    if (!anchors.length) {
      currentMessageAnchorId.value = "";
      return;
    }
    const threshold = Number(wrapRef.scrollTop || 0) + 24;
    let currentAnchor = anchors[0];
    for (const anchor of anchors) {
      if (Number(anchor.offsetTop || 0) <= threshold) currentAnchor = anchor;
      else break;
    }
    const nextAnchorId = getAnchorId(currentAnchor);
    if (shouldKeepNavigatorScrollLock(wrapRef, nextAnchorId)) return;
    currentMessageAnchorId.value = nextAnchorId;
  }

  function bindChatMessageScrollSync() {
    const wrapRef = messageListPanelRef.value?.getWrapRef?.();
    if (!wrapRef || wrapRef.__noobotChatNavScrollSyncBound) return;
    wrapRef.addEventListener?.("scroll", syncCurrentMessageAnchorId, { passive: true });
    wrapRef.__noobotChatNavScrollSyncBound = true;
    syncCurrentMessageAnchorId();
  }

  function unbindChatMessageScrollSync() {
    const wrapRef = messageListPanelRef.value?.getWrapRef?.();
    if (!wrapRef || !wrapRef.__noobotChatNavScrollSyncBound) return;
    wrapRef.removeEventListener?.("scroll", syncCurrentMessageAnchorId);
    delete wrapRef.__noobotChatNavScrollSyncBound;
  }

  return {
    syncCurrentMessageAnchorId,
    bindChatMessageScrollSync,
    unbindChatMessageScrollSync,
  };
}
