import { describe, expect, it, vi } from "vitest";
import { createChatMessageScrollSync } from "../../../src/app/chatMessageScrollSync";

function createAnchor({ top, anchorId = "", id = "" }) {
  return {
    offsetTop: top,
    id,
    dataset: { chatMessageAnchor: anchorId },
  };
}

function createWrapRef(anchors = [], scrollTop = 0) {
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

  it("highlights the latest anchor above the scroll threshold and falls back to element id", () => {
    const currentMessageAnchorId = { value: "" };
    const wrapRef = createWrapRef(
      [
        createAnchor({ top: 0, anchorId: "message-1" }),
        createAnchor({ top: 84, id: "message-2" }),
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
});
