/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { RoleEnum } from "../../../shared/constants/chatConstants";
import { normalizeTrimmedString } from "./utils";

export async function finalizeDoneSessionDetail({
  activeSession,
  activeSessionId,
  botMessage,
  finalDoneEventData,
  fetchSessionDetail,
  applySessionDetail,
  refreshSessionConnectorsAsync,
} = {}) {
  const doneSessionId = String(
    finalDoneEventData?.sessionId || activeSession?.value?.backendSessionId || "",
  );
  const finalExecutionLogTotal = Number(botMessage?.executionLogTotal || 0);
  const finalDialogProcessId = normalizeTrimmedString(
    botMessage?.dialogProcessId || finalDoneEventData?.dialogProcessId,
  );

  if (!doneSessionId) return false;

  try {
    const detail = await fetchSessionDetail(doneSessionId);
    const shouldPreserveCurrentMessages =
      String(doneSessionId || "") === String(activeSession?.value?.backendSessionId || "") &&
      String(activeSession?.value?.id || "") === String(activeSessionId?.value || "");

    applySessionDetail(detail, {
      preserveCurrentMessages: shouldPreserveCurrentMessages,
    });

    if (finalExecutionLogTotal > 0 && finalDialogProcessId) {
      const patchExecutionTotal = (messages = []) => {
        for (const messageItem of Array.isArray(messages) ? messages : []) {
          if (normalizeTrimmedString(messageItem?.role) !== RoleEnum.ASSISTANT) continue;
          if (normalizeTrimmedString(messageItem?.dialogProcessId) !== finalDialogProcessId) {
            continue;
          }
          messageItem.executionLogTotal = Math.max(
            Number(messageItem?.executionLogTotal || 0),
            finalExecutionLogTotal,
          );
        }
      };
      patchExecutionTotal(activeSession?.value?.messages || []);
      patchExecutionTotal(activeSession?.value?.rawMessages || []);
    }

    refreshSessionConnectorsAsync(activeSession?.value?.id || doneSessionId);
    return true;
  } catch (loadDetailError) {
    console.warn("load session detail after done failed", loadDetailError);
    return false;
  }
}
