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

function createAnchor({ top, anchorId }) {
  return {
    offsetTop: top,
    dataset: { chatMessageAnchor: anchorId },
  };
}

function createWrapRef(anchors, scrollTop) {
  return {
    scrollTop,
    querySelectorAll: vi.fn(() => anchors),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  };
}

describe("chat message scroll sync", () => {
  it("clears the current anchor when the message list wrapper has no anchors", () => {
    const currentMessageAnchorId = { value: "old-anchor" };
    const wrapRef = createWrapRef([], 120);
    const messageListPanelRef = { value: { getWrapRef: () => wrapRef } };
    const { syncCurrentMessageAnchorId } = createChatMessageScrollSync({
      currentMessageAnchorId,
      messageListPanelRef,
    });

    syncCurrentMessageAnchorId();

    expect(wrapRef.querySelectorAll).toHaveBeenCalledWith("[data-chat-message-anchor]");
    expect(currentMessageAnchorId.value).toBe("");
  });

  it("highlights the latest anchor above the scroll threshold", () => {
    const currentMessageAnchorId = { value: "" };
    const wrapRef = createWrapRef(
      [
        createAnchor({ top: 0, anchorId: "message-1" }),
        createAnchor({ top: 84, anchorId: "message-2" }),
        createAnchor({ top: 200, anchorId: "message-3" }),
      ],
      72,
    );
    const messageListPanelRef = { value: { getWrapRef: () => wrapRef } };
    const { syncCurrentMessageAnchorId } = createChatMessageScrollSync({
      currentMessageAnchorId,
      messageListPanelRef,
    });

    syncCurrentMessageAnchorId();

    expect(currentMessageAnchorId.value).toBe("message-2");
  });

  it("keeps the clicked navigator target highlighted while smooth scrolling past middle anchors", () => {
    const currentMessageAnchorId = { value: "message-4" };
    const wrapRef = createWrapRef(
      [
        createAnchor({ top: 0, anchorId: "message-1" }),
        createAnchor({ top: 100, anchorId: "message-2" }),
        createAnchor({ top: 200, anchorId: "message-3" }),
        createAnchor({ top: 300, anchorId: "message-4" }),
      ],
      176,
    );
    const messageListPanelRef = { value: { getWrapRef: () => wrapRef } };
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
    const wrapRef = createWrapRef(
      [
        createAnchor({ top: 0, anchorId: "message-1" }),
        createAnchor({ top: 100, anchorId: "message-2" }),
        createAnchor({ top: 200, anchorId: "message-3" }),
        createAnchor({ top: 300, anchorId: "message-4" }),
      ],
      276,
    );
    const messageListPanelRef = { value: { getWrapRef: () => wrapRef } };
    const { syncCurrentMessageAnchorId } = createChatMessageScrollSync({
      currentMessageAnchorId,
      messageListPanelRef,
    });

    lockChatMessageScrollSyncToAnchor(wrapRef, "message-4");
    syncCurrentMessageAnchorId();
    wrapRef.scrollTop = 76;
    syncCurrentMessageAnchorId();

    expect(currentMessageAnchorId.value).toBe("message-2");
  });

  it("expires the navigator scroll lock and resumes normal scroll sync", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-19T00:00:00.000Z"));
    try {
      const currentMessageAnchorId = { value: "message-4" };
      const wrapRef = createWrapRef(
        [
          createAnchor({ top: 0, anchorId: "message-1" }),
          createAnchor({ top: 100, anchorId: "message-2" }),
          createAnchor({ top: 200, anchorId: "message-3" }),
          createAnchor({ top: 300, anchorId: "message-4" }),
        ],
        176,
      );
      const messageListPanelRef = { value: { getWrapRef: () => wrapRef } };
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
    const wrapRef = createWrapRef([createAnchor({ top: 0, anchorId: "message-1" })], 0);
    const messageListPanelRef = { value: { getWrapRef: () => wrapRef } };
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
    const wrapRef = createWrapRef([createAnchor({ top: 0, anchorId: "message-1" })], 0);
    const messageListPanelRef = { value: { getWrapRef: () => wrapRef } };
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
