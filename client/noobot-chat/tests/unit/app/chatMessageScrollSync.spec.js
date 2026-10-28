/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { describe, expect, it, vi } from "vitest";
import {
  CHAT_MESSAGE_NAVIGATOR_SCROLL_LOCK_MS,
  createChatMessageScrollSync,
  lockChatMessageScrollSyncToAnchor,
} from "../../../src/app/runtime/chatMessageScrollSync.js";

function createPanel(currentAnchorId) {
  const wrapRef = {
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  };
  const panel = {
    currentAnchorId,
    getWrapRef: () => wrapRef,
    resolveCurrentMessageAnchorId: vi.fn(() => panel.currentAnchorId),
  };
  return { panel, wrapRef, messageListPanelRef: { value: panel } };
}

describe("chat message scroll sync", () => {
  it("clears the current anchor when the panel resolves no current message", () => {
    const currentMessageAnchorId = { value: "old-anchor" };
    const { panel, messageListPanelRef } = createPanel("");
    const { syncCurrentMessageAnchorId } = createChatMessageScrollSync({
      currentMessageAnchorId,
      messageListPanelRef,
    });

    syncCurrentMessageAnchorId();

    expect(panel.resolveCurrentMessageAnchorId).toHaveBeenCalledTimes(1);
    expect(currentMessageAnchorId.value).toBe("");
  });

  it("highlights the anchor resolved by the message list panel", () => {
    const currentMessageAnchorId = { value: "" };
    const { messageListPanelRef } = createPanel("message-2");
    const { syncCurrentMessageAnchorId } = createChatMessageScrollSync({
      currentMessageAnchorId,
      messageListPanelRef,
    });

    syncCurrentMessageAnchorId();

    expect(currentMessageAnchorId.value).toBe("message-2");
  });

  it("keeps the navigator target highlighted while the list repositions past other anchors", () => {
    const currentMessageAnchorId = { value: "message-4" };
    const { wrapRef, messageListPanelRef } = createPanel("message-3");
    const { syncCurrentMessageAnchorId } = createChatMessageScrollSync({
      currentMessageAnchorId,
      messageListPanelRef,
    });

    lockChatMessageScrollSyncToAnchor(wrapRef, "message-4");
    syncCurrentMessageAnchorId();

    expect(currentMessageAnchorId.value).toBe("message-4");
  });

  it("releases the navigator scroll lock when the target anchor becomes current", () => {
    const currentMessageAnchorId = { value: "message-4" };
    const { panel, wrapRef, messageListPanelRef } = createPanel("message-4");
    const { syncCurrentMessageAnchorId } = createChatMessageScrollSync({
      currentMessageAnchorId,
      messageListPanelRef,
    });

    lockChatMessageScrollSyncToAnchor(wrapRef, "message-4");
    syncCurrentMessageAnchorId();
    panel.currentAnchorId = "message-2";
    syncCurrentMessageAnchorId();

    expect(currentMessageAnchorId.value).toBe("message-2");
  });

  it("expires the navigator scroll lock and resumes normal scroll sync", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-19T00:00:00.000Z"));
    try {
      const currentMessageAnchorId = { value: "message-4" };
      const { wrapRef, messageListPanelRef } = createPanel("message-3");
      const { syncCurrentMessageAnchorId } = createChatMessageScrollSync({
        currentMessageAnchorId,
        messageListPanelRef,
      });

      lockChatMessageScrollSyncToAnchor(wrapRef, "message-4");
      vi.advanceTimersByTime(CHAT_MESSAGE_NAVIGATOR_SCROLL_LOCK_MS + 1);
      syncCurrentMessageAnchorId();

      expect(currentMessageAnchorId.value).toBe("message-3");
    } finally {
      vi.useRealTimers();
    }
  });

  it("binds passive scroll sync only once and performs an immediate sync", () => {
    const currentMessageAnchorId = { value: "" };
    const { wrapRef, messageListPanelRef } = createPanel("message-1");
    const scrollSync = createChatMessageScrollSync({ currentMessageAnchorId, messageListPanelRef });

    scrollSync.bindChatMessageScrollSync();
    scrollSync.bindChatMessageScrollSync();

    expect(wrapRef.addEventListener).toHaveBeenCalledTimes(1);
    expect(wrapRef.addEventListener).toHaveBeenCalledWith(
      "scroll",
      scrollSync.syncCurrentMessageAnchorId,
      { passive: true },
    );
    expect(wrapRef.__noobotChatNavScrollSyncBound).toBe(true);
    expect(currentMessageAnchorId.value).toBe("message-1");
  });

  it("unbinds the scroll listener and removes the bound marker", () => {
    const currentMessageAnchorId = { value: "" };
    const { wrapRef, messageListPanelRef } = createPanel("message-1");
    const scrollSync = createChatMessageScrollSync({ currentMessageAnchorId, messageListPanelRef });

    scrollSync.bindChatMessageScrollSync();
    scrollSync.unbindChatMessageScrollSync();

    expect(wrapRef.removeEventListener).toHaveBeenCalledWith(
      "scroll",
      scrollSync.syncCurrentMessageAnchorId,
    );
    expect(wrapRef.__noobotChatNavScrollSyncBound).toBeUndefined();
  });

  it("does nothing while the message list panel is not mounted", () => {
    const currentMessageAnchorId = { value: "keep-anchor" };
    const messageListPanelRef = { value: null };
    const scrollSync = createChatMessageScrollSync({ currentMessageAnchorId, messageListPanelRef });

    expect(() => scrollSync.bindChatMessageScrollSync()).not.toThrow();
    expect(() => scrollSync.syncCurrentMessageAnchorId()).not.toThrow();
    expect(() => scrollSync.unbindChatMessageScrollSync()).not.toThrow();
    expect(currentMessageAnchorId.value).toBe("keep-anchor");
  });
});
