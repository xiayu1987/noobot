/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { nowMs } from "../../modules/chat/model/timeFields.js";
import { TIME_THRESHOLDS } from "@noobot/shared/time-thresholds";
import { isCanonicalText } from "@noobot/shared/value";
const CHAT_MESSAGE_NAVIGATOR_SCROLL_LOCK_KEY = "__noobotChatNavPendingAnchor";
export const CHAT_MESSAGE_NAVIGATOR_SCROLL_LOCK_MS =
  TIME_THRESHOLDS.client.chatMessageNavigatorScrollLockMs;

export function lockChatMessageScrollSyncToAnchor(wrapRef, anchor) {
  if (!isCanonicalText(anchor)) throw new TypeError("chat message scroll lock requires anchor");
  wrapRef[CHAT_MESSAGE_NAVIGATOR_SCROLL_LOCK_KEY] = {
    anchor,
    expiresAt: nowMs() + CHAT_MESSAGE_NAVIGATOR_SCROLL_LOCK_MS,
  };
}

function shouldKeepNavigatorScrollLock(wrapRef, nextAnchorId) {
  const lock = wrapRef[CHAT_MESSAGE_NAVIGATOR_SCROLL_LOCK_KEY];
  if (lock === undefined) return false;
  if (nowMs() > lock.expiresAt) {
    delete wrapRef[CHAT_MESSAGE_NAVIGATOR_SCROLL_LOCK_KEY];
    return false;
  }
  if (nextAnchorId === lock.anchor) {
    delete wrapRef[CHAT_MESSAGE_NAVIGATOR_SCROLL_LOCK_KEY];
    return false;
  }
  return true;
}

export function readMountedMessageListPanel(messageListPanelRef) {
  return messageListPanelRef.value;
}

export function readMountedMessageListWrap(messageListPanelRef) {
  const panel = readMountedMessageListPanel(messageListPanelRef);
  return panel === null ? null : panel.getWrapRef();
}

export function createChatMessageScrollSync({ currentMessageAnchorId, messageListPanelRef }) {
  function syncCurrentMessageAnchorId() {
    const wrapRef = readMountedMessageListWrap(messageListPanelRef);
    if (wrapRef === null) return;
    const anchors = Array.from(wrapRef.querySelectorAll("[data-chat-message-anchor]"));
    if (!anchors.length) {
      currentMessageAnchorId.value = "";
      return;
    }
    const threshold = wrapRef.scrollTop + 24;
    let currentAnchor = anchors[0];
    for (const anchor of anchors) {
      if (anchor.offsetTop <= threshold) currentAnchor = anchor;
      else break;
    }
    const nextAnchorId = currentAnchor.dataset.chatMessageAnchor;
    if (shouldKeepNavigatorScrollLock(wrapRef, nextAnchorId)) return;
    currentMessageAnchorId.value = nextAnchorId;
  }

  function bindChatMessageScrollSync() {
    const wrapRef = readMountedMessageListWrap(messageListPanelRef);
    if (wrapRef === null || wrapRef.__noobotChatNavScrollSyncBound) return;
    wrapRef.addEventListener("scroll", syncCurrentMessageAnchorId, { passive: true });
    wrapRef.__noobotChatNavScrollSyncBound = true;
    syncCurrentMessageAnchorId();
  }

  function unbindChatMessageScrollSync() {
    const wrapRef = readMountedMessageListWrap(messageListPanelRef);
    if (wrapRef === null || !wrapRef.__noobotChatNavScrollSyncBound) return;
    wrapRef.removeEventListener("scroll", syncCurrentMessageAnchorId);
    delete wrapRef.__noobotChatNavScrollSyncBound;
  }

  return {
    syncCurrentMessageAnchorId,
    bindChatMessageScrollSync,
    unbindChatMessageScrollSync,
  };
}
