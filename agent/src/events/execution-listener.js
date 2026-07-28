/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { createLlmDeltaVisibilityFilter } from "./llm-filter.js";
import { classifyExecutionEvent } from "../observability/event-log/log-normalizer.js";
import { resolveDialogProcessIdFromContext } from "../context/session/dialog-process-id-resolver.js";
import { resolveParentSessionId } from "../context/parent-session-id-resolver.js";

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
  const llmDeltaVisibilityFilter = createLlmDeltaVisibilityFilter();
  const defaults = { dialogProcessId, sessionId, parentSessionId, turnScopeId };

  return {
    onEvent: (evt = {}) => {
      const event = evt?.event || "";
      const data = evt?.data || {};
      const ts = evt?.ts || new Date().toISOString();

      if (event === "llm_delta") {
        const normalizedData = data?.subAgentCall
          ? { ...data }
          : {
              ...data,
              text: llmDeltaVisibilityFilter.push(String(data?.text || "")),
            };
        if (!normalizedData?.subAgentCall && !String(normalizedData?.text || "")) {
          return;
        }
        try {
          upstream?.onEvent?.({
            event,
            data: enrichEventData(normalizedData, defaults),
            ts,
          });
        } catch {
        }
        return;
      }

      const { category, type } = classifyExecutionEvent(event);
      try {
        const maybePromise = sessionManager?.appendExecutionLog?.({
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
        if (maybePromise?.catch) maybePromise.catch(() => {});
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
