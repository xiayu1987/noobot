/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { RoleEnum, StreamEventEnum } from "../../../shared/constants/chatConstants";
import { findLatestPendingAssistantAfterLastUser } from "../../infra/reconnectReplayModel";
import { _ensureArray, _trimStr } from "./utils";
import { findAssistantMessageByDialogProcessId } from "./messageLookup";

export function shouldHydrateSessionBeforeReplay({
  activeSession,
  messages = [],
  dialogProcessId = "",
  allowCreate = true,
} = {}) {
  const normalizedDpId = _trimStr(dialogProcessId);
  if (!allowCreate || !normalizedDpId || !activeSession?.value) return false;
  if (findAssistantMessageByDialogProcessId(activeSession, normalizedDpId)) return false;
  const messageList = Array.isArray(activeSession.value.messages)
    ? activeSession.value.messages
    : [];
  if (findLatestPendingAssistantAfterLastUser(messageList)) return false;
  const lastMessage = messageList.length ? messageList[messageList.length - 1] : null;
  if (_trimStr(lastMessage?.role) === RoleEnum.USER) return false;
  return (_ensureArray(messages)).some((envelope) => {
    const eventName = _trimStr(envelope?.event);
    return eventName === StreamEventEnum.DELTA || eventName === StreamEventEnum.THINKING;
  });
}

export async function renderActiveSessionBeforeReplay({
  activeSession,
  activeSessionId,
  chatList,
  getReplayHydrationPromise = () => null,
  setReplayHydrationPromise = () => {},
  onError = console.warn,
} = {}) {
  if (!activeSession?.value) return false;
  const existingPromise = getReplayHydrationPromise();
  if (existingPromise) return existingPromise;
  const backendSessionId = String(
    activeSession.value?.backendSessionId || activeSessionId?.value || "",
  ).trim();
  if (
    !backendSessionId ||
    typeof chatList?.fetchSessionDetail !== "function" ||
    typeof chatList?.applySessionDetail !== "function"
  ) {
    return false;
  }
  const hydrationPromise = (async () => {
    try {
      const detail = await chatList.fetchSessionDetail(backendSessionId, {
        source: "reconnectHydration",
        reuseRecentlyLoaded: true,
        allowLoadedSnapshot: true,
      });
      if (!detail) return false;
      chatList.applySessionDetail(detail, { preserveCurrentMessages: false });
      return true;
    } catch (error) {
      onError(error);
      return false;
    } finally {
      setReplayHydrationPromise(null);
    }
  })();
  setReplayHydrationPromise(hydrationPromise);
  return hydrationPromise;
}

export async function hydrateSessionBeforeReconnectReplayIfNeeded({
  activeSession,
  activeSessionId,
  chatList,
  messages = [],
  dialogProcessId = "",
  allowCreate = true,
  getReplayHydrationPromise = () => null,
  setReplayHydrationPromise = () => {},
  onError = console.warn,
} = {}) {
  if (!shouldHydrateSessionBeforeReplay({
    activeSession,
    messages,
    dialogProcessId,
    allowCreate,
  })) {
    return false;
  }
  return renderActiveSessionBeforeReplay({
    activeSession,
    activeSessionId,
    chatList,
    getReplayHydrationPromise,
    setReplayHydrationPromise,
    onError,
  });
}

