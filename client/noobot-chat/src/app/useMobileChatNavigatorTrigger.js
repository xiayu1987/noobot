/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { computed, ref } from "vue";
import {
  clampMobileChatNavigatorTriggerPosition,
  loadMobileChatNavigatorTriggerPosition,
  persistMobileChatNavigatorTriggerPosition,
} from "./mobileChatNavigatorTriggerPosition";

const MOBILE_CHAT_NAVIGATOR_DRAGGING_CLASS = "noobot-mobile-chat-navigator-dragging";

export function useMobileChatNavigatorTrigger({ isMobile, openChatMessageNavigator }) {
  const mobileChatNavigatorTriggerPosition = ref(loadMobileChatNavigatorTriggerPosition());
  const mobileChatNavigatorTriggerDragging = ref(false);
  const mobileChatNavigatorTriggerMoved = ref(false);
  const mobileChatNavigatorTriggerPointer = {
    id: null,
    startX: 0,
    startY: 0,
    offsetX: 0,
    offsetY: 0,
  };

  function preventMobileChatNavigatorDocumentTouch(event) {
    if (!mobileChatNavigatorTriggerDragging.value) return;
    event?.preventDefault?.();
  }

  function setMobileChatNavigatorDragLock(locked) {
    document?.documentElement?.classList?.toggle(MOBILE_CHAT_NAVIGATOR_DRAGGING_CLASS, Boolean(locked));
    document?.body?.classList?.toggle(MOBILE_CHAT_NAVIGATOR_DRAGGING_CLASS, Boolean(locked));
    if (locked) window?.addEventListener?.("touchmove", preventMobileChatNavigatorDocumentTouch, { passive: false });
    else window?.removeEventListener?.("touchmove", preventMobileChatNavigatorDocumentTouch, { passive: false });
  }

  const mobileChatNavigatorTriggerStyle = computed(() => {
    const position = mobileChatNavigatorTriggerPosition.value || {};
    if (Number.isFinite(Number(position.left)) && Number.isFinite(Number(position.top))) {
      return {
        left: `${Number(position.left)}px`,
        top: `${Number(position.top)}px`,
        right: "auto",
        bottom: "auto",
      };
    }
    return {
      right: `calc(${Number(position.right ?? 16)}px + env(safe-area-inset-right))`,
      bottom: `calc(${Number(position.bottom ?? 112)}px + env(safe-area-inset-bottom))`,
      left: "auto",
      top: "auto",
    };
  });

  function preventMobileChatNavigatorTriggerGesture(event) {
    event?.stopPropagation?.();
    if (event?.cancelable) event.preventDefault?.();
  }

  function handleMobileChatNavigatorTriggerPointerDown(event) {
    if (!isMobile.value || !event?.currentTarget) return;
    preventMobileChatNavigatorTriggerGesture(event);
    const rect = event.currentTarget.getBoundingClientRect?.();
    if (!rect) return;
    mobileChatNavigatorTriggerDragging.value = true;
    mobileChatNavigatorTriggerMoved.value = false;
    mobileChatNavigatorTriggerPointer.id = event.pointerId;
    mobileChatNavigatorTriggerPointer.startX = event.clientX;
    mobileChatNavigatorTriggerPointer.startY = event.clientY;
    mobileChatNavigatorTriggerPointer.offsetX = event.clientX - rect.left;
    mobileChatNavigatorTriggerPointer.offsetY = event.clientY - rect.top;
    setMobileChatNavigatorDragLock(true);
    event.currentTarget.setPointerCapture?.(event.pointerId);
  }

  function handleMobileChatNavigatorTriggerPointerMove(event) {
    if (!mobileChatNavigatorTriggerDragging.value || event.pointerId !== mobileChatNavigatorTriggerPointer.id) return;
    preventMobileChatNavigatorTriggerGesture(event);
    const deltaX = Math.abs(event.clientX - mobileChatNavigatorTriggerPointer.startX);
    const deltaY = Math.abs(event.clientY - mobileChatNavigatorTriggerPointer.startY);
    if (deltaX > 4 || deltaY > 4) mobileChatNavigatorTriggerMoved.value = true;
    mobileChatNavigatorTriggerPosition.value = clampMobileChatNavigatorTriggerPosition(
      event.clientX - mobileChatNavigatorTriggerPointer.offsetX,
      event.clientY - mobileChatNavigatorTriggerPointer.offsetY,
    );
  }

  function handleMobileChatNavigatorTriggerPointerUp(event) {
    if (!mobileChatNavigatorTriggerDragging.value || event.pointerId !== mobileChatNavigatorTriggerPointer.id) return;
    preventMobileChatNavigatorTriggerGesture(event);
    mobileChatNavigatorTriggerDragging.value = false;
    mobileChatNavigatorTriggerPointer.id = null;
    setMobileChatNavigatorDragLock(false);
    if (mobileChatNavigatorTriggerMoved.value) {
      persistMobileChatNavigatorTriggerPosition(mobileChatNavigatorTriggerPosition.value);
      window.setTimeout(() => {
        mobileChatNavigatorTriggerMoved.value = false;
      }, 0);
      return;
    }
    mobileChatNavigatorTriggerMoved.value = false;
    openChatMessageNavigator?.();
  }

  function handleMobileChatNavigatorTriggerClick() {
    if (mobileChatNavigatorTriggerMoved.value) return;
    openChatMessageNavigator?.();
  }

  function releaseMobileChatNavigatorTrigger() {
    setMobileChatNavigatorDragLock(false);
  }

  return {
    mobileChatNavigatorTriggerStyle,
    mobileChatNavigatorTriggerDragging,
    handleMobileChatNavigatorTriggerClick,
    handleMobileChatNavigatorTriggerPointerDown,
    handleMobileChatNavigatorTriggerPointerMove,
    handleMobileChatNavigatorTriggerPointerUp,
    releaseMobileChatNavigatorTrigger,
  };
}
