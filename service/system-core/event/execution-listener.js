/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 *
 * Composite execution event listener — orchestrates LLM delta filtering,
 * execution log persistence, and upstream event forwarding.
 */

import { createLlmDeltaVisibilityFilter } from "./llm-filter.js";
import { classifyExecutionEvent } from "../tracking/event-log/log-normalizer.js";

/**
 * Enrich raw event data with resolved session/dialog identifiers.
 * Falls back to listener-level defaults when data fields are absent.
 */
function enrichEventData(rawData = {}, defaults = {}) {
  const eventData = rawData && typeof rawData === "object" ? rawData : {};
  return {
    ...eventData,
    dialogProcessId: String(
      eventData?.dialogProcessId || defaults.dialogProcessId || "",
    ),
    sessionId: String(eventData?.sessionId || defaults.sessionId || ""),
    parentSessionId: String(
      eventData?.parentSessionId || defaults.parentSessionId || "",
    ),
  };
}

export function createExecutionEventListener({
  sessionManager = null,
  userId = "",
  sessionId = "",
  parentSessionId = "",
  upstream = null,
}) {
  const dialogProcessId = upstream?.dialogProcessId || "";
  const llmDeltaVisibilityFilter = createLlmDeltaVisibilityFilter();
  const defaults = { dialogProcessId, sessionId, parentSessionId };

  return {
    onEvent: (evt = {}) => {
      const event = evt?.event || "";
      const data = evt?.data || {};
      const ts = evt?.ts || new Date().toISOString();

      // --- LLM delta: filter thinking tags, forward visible text only ---
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
          // Upstream listener errors should not interrupt the main execution flow.
        }
        return;
      }

      // --- Classify & persist execution log ---
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
        // Log write errors should not interrupt the main execution flow.
      }

      // --- Forward to upstream listener ---
      try {
        upstream?.onEvent?.({
          event,
          data: enrichEventData(data, defaults),
          ts,
        });
      } catch {
        // Upstream listener errors should not interrupt the main execution flow.
      }
    },
  };
}
