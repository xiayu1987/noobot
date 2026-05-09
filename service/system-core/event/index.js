/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 *
 * Event module - backward-compatible re-exports.
 * Actual implementations are split into:
 *   - emitter.js         (emitEvent)
 *   - llm-filter.js      (createLlmDeltaVisibilityFilter)
 *   - log-normalizer.js  (classifyExecutionEvent, normalizeSseLogEvent)
 */

export { emitEvent } from "./emitter.js";
export { createLlmDeltaVisibilityFilter } from "./llm-filter.js";
export { classifyExecutionEvent, normalizeSseLogEvent } from "./log-normalizer.js";

// Re-export the composite execution event listener (depends on all sub-modules)
import { createLlmDeltaVisibilityFilter } from "./llm-filter.js";
import { classifyExecutionEvent } from "./log-normalizer.js";

export function createExecutionEventListener({
  sessionManager = null,
  userId = "",
  sessionId = "",
  parentSessionId = "",
  upstream = null,
}) {
  const dialogProcessId = upstream?.dialogProcessId || "";
  const llmDeltaVisibilityFilter = createLlmDeltaVisibilityFilter();
  const enrichEventData = (rawData = {}) => {
    const eventData = rawData && typeof rawData === "object" ? rawData : {};
    const resolvedDialogProcessId = String(
      eventData?.dialogProcessId || dialogProcessId || "",
    );
    const resolvedSessionId = String(eventData?.sessionId || sessionId || "");
    const resolvedParentSessionId = String(
      eventData?.parentSessionId || parentSessionId || "",
    );
    return {
      ...eventData,
      dialogProcessId: resolvedDialogProcessId,
      sessionId: resolvedSessionId,
      parentSessionId: resolvedParentSessionId,
    };
  };
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
            data: enrichEventData(normalizedData),
            ts,
          });
        } catch {
          // ignore upstream listener errors
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
        // ignore log write errors
      }

      try {
        upstream?.onEvent?.({
          event,
          data: enrichEventData(data),
          ts,
        });
      } catch {
        // ignore upstream listener errors
      }
    },
  };
}
