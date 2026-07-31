/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { classifyExecutionEvent } from "../observability/event-log/log-normalizer.js";
import { resolveDialogProcessIdFromContext } from "../context/session/dialog-process-id-resolver.js";
import { resolveParentSessionId } from "../context/parent-session-id-resolver.js";

const INTERNAL_TRANSPORT_EVENTS = new Set([
  "turn_lifecycle_committed",
]);

function enrichEventData(rawData = {}, defaults = {}) {
  const eventData = rawData && typeof rawData === "object" ? rawData : {};
  return {
    ...eventData,
    dialogProcessId: resolveDialogProcessIdFromContext({
      dialogProcessId: eventData?.dialogProcessId,
      currentDialogProcessId: defaults.dialogProcessId,
    }),
    sessionId: String(eventData?.sessionId || defaults.sessionId || ""),
    turnScopeId: String(eventData?.turnScopeId || defaults.turnScopeId || ""),
    parentSessionId: resolveParentSessionId({
      context: { parentSessionId: eventData?.parentSessionId },
      parentSessionId: defaults.parentSessionId,
    }),
  };
}

export function createExecutionEventListener({
  sessionManager = null,
  userId = "",
  sessionId = "",
  parentSessionId = "",
  turnScopeId = "",
  upstream = null,
}) {
  const dialogProcessId = resolveDialogProcessIdFromContext(upstream);
  const defaults = { dialogProcessId, sessionId, parentSessionId, turnScopeId };
  let persistenceTail = Promise.resolve();

  const appendExecutionLog = (record) => {
    persistenceTail = persistenceTail
      .catch(() => {})
      .then(() => sessionManager?.appendExecutionLog?.(record))
      .catch(() => {});
    return persistenceTail;
  };

  return {
    flushPersistence: () => persistenceTail,
    onEvent: (evt = {}) => {
      const event = evt?.event || "";
      const data = evt?.data || {};
      const ts = evt?.ts || new Date().toISOString();

      if (event === "llm_delta" || INTERNAL_TRANSPORT_EVENTS.has(event)) {
        try {
          upstream?.onEvent?.({
            event,
            data: enrichEventData(data, defaults),
            ts,
          });
        } catch {
        }
        return;
      }

      const { category, type } = classifyExecutionEvent(event);
      try {
        appendExecutionLog({
          userId,
          sessionId,
          parentSessionId,
          dialogProcessId,
          event,
          category,
          type,
          data,
          ts,
        });
      } catch {
      }

      try {
        upstream?.onEvent?.({
          event,
          data: enrichEventData(data, defaults),
          ts,
        });
      } catch {
      }
    },
  };
}
