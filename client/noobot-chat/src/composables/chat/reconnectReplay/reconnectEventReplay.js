/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { StreamEventEnum } from "../../../shared/constants/chatConstants";
import { BackendChannelState } from "../sessionRunStateMachine";
import { normalizeReplayCacheKey } from "./replayCache";
import { _trimStr } from "./utils";

export async function applyReconnectEventReplay({
  event,
  data,
  replayCache,
  isCurrentActiveSession,
  isCurrentActiveDialogProcess,
  consumeReplayCacheForSession,
  applyReconnectMessagesToActiveSession,
  applyChannelState,
} = {}) {
  if (_trimStr(event) === StreamEventEnum.CHANNEL_STATE) {
    return applyChannelState(data || {});
  }

  const dialogProcessId = _trimStr(data?.dialogProcessId);
  const sessionId = _trimStr(data?.sessionId);
  if (sessionId && isCurrentActiveSession(sessionId)) {
    await consumeReplayCacheForSession(sessionId);
    await applyReconnectMessagesToActiveSession([{ event, data }], dialogProcessId);
    if (_trimStr(event) === StreamEventEnum.DONE) {
      await applyChannelState({
        ...(data || {}),
        sessionId,
        dialogProcessId,
        state: BackendChannelState.COMPLETED,
        sourceEvent: "done",
      });
    }
    return;
  }

  if (!sessionId && dialogProcessId && isCurrentActiveDialogProcess?.(dialogProcessId)) {
    await applyReconnectMessagesToActiveSession([{ event, data }], dialogProcessId);
    if (_trimStr(event) === StreamEventEnum.DONE) {
      await applyChannelState({
        ...(data || {}),
        dialogProcessId,
        state: BackendChannelState.COMPLETED,
        sourceEvent: "done",
      });
    }
    return;
  }

  if (sessionId) {
    const replayKey = normalizeReplayCacheKey(dialogProcessId, sessionId);
    if (!replayCache[sessionId]) replayCache[sessionId] = {};
    if (!replayCache[sessionId][replayKey]) replayCache[sessionId][replayKey] = [];
    replayCache[sessionId][replayKey].push({ event, data });
  }
}
