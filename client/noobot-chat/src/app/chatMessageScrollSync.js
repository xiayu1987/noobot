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
    currentMessageAnchorId.value = String(
      currentAnchor?.dataset?.chatMessageAnchor || currentAnchor?.id || "",
    );
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
