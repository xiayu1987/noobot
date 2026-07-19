/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { normalizeSseLogEvent } from "#agent/event";
import {
  buildParentOwnedChildRunPayload,
  isChildRunEventData,
  parentOwnsChildRunEventData,
} from "./child-run-events.js";

/**
 * Builds the per-run `eventListener` passed to `bot.runSession`. It maps agent
 * runtime events onto WebSocket frames, handling non-streaming suppression,
 * attachment forwarding and sub-run (child) event re-parenting.
 *
 * Connection-level state is read through accessors so the listener keeps
 * observing live run metadata; `currentRunMeta`/`currentRunHandle` are mutated
 * in place to record the resolved dialogProcessId, matching the original inline
 * behavior.
 */
export function createRunEventListener({
  sendEvent,
  sessionId,
  textStreamingEnabled,
  registerActiveRun,
  getCurrentRunMeta = () => null,
  getCurrentRunHandle = () => null,
  getCurrentTurnScopeId = () => "",
  onRootRunning = null,
} = {}) {
  const resolveTurnScopeId = () =>
    getCurrentRunMeta()?.turnScopeId || getCurrentTurnScopeId() || "";

  return {
    onEvent: (eventPayload) => {
      const eventName = eventPayload?.event || "thinking";
      const eventData = eventPayload?.data || {};
      const eventDialogProcessId = String(eventData?.dialogProcessId || "").trim();
      const currentRunMeta = getCurrentRunMeta();
      const currentRunHandle = getCurrentRunHandle();
      const childRunEvent = isChildRunEventData(eventData, {
        rootSessionId: sessionId,
      });
      if (
        eventName === "agent_lifecycle_state_changed" &&
        String(eventData?.state || "").trim().toLowerCase() === "running" &&
        !childRunEvent
      ) {
        const expectedTurnScopeId = resolveTurnScopeId();
        const eventSessionId = String(eventData?.sessionId || "").trim();
        const eventTurnScopeId = String(eventData?.turnScopeId || "").trim();
        if (
          eventSessionId === String(sessionId || "").trim() &&
          eventTurnScopeId &&
          eventTurnScopeId === expectedTurnScopeId &&
          typeof onRootRunning === "function"
        ) {
          onRootRunning(eventData);
        }
      }
      const parentDialogProcessId =
        currentRunMeta?.dialogProcessId ||
        eventData?.parentDialogProcessId ||
        currentRunMeta?.parentDialogProcessId ||
        "";
      if (eventDialogProcessId && currentRunMeta && !childRunEvent) {
        currentRunMeta.dialogProcessId = eventDialogProcessId;
        if (currentRunHandle) {
          currentRunHandle.dialogProcessId = eventDialogProcessId;
          registerActiveRun(currentRunHandle);
        }
      }
      if (eventName === "llm_delta") {
        if (!textStreamingEnabled) {
          // Non-streaming mode: suppress token deltas, keep other system/tool events.
          return;
        }
        if (childRunEvent) {
          const parentOwnedData = parentOwnsChildRunEventData(eventData, {
            rootSessionId: sessionId,
            parentDialogProcessId,
          });
          const normalizedEvent = normalizeSseLogEvent({
            ...eventPayload,
            event: "subagent_llm_delta",
            data: {
              ...parentOwnedData,
              category: "system",
              type: "subagent_delta",
              event: "subagent_delta",
              text: String(parentOwnedData.text || ""),
            },
          });
          sendEvent(
            normalizedEvent.event,
            buildParentOwnedChildRunPayload(normalizedEvent.data, parentOwnedData, {
              rootSessionId: sessionId,
              turnScopeId: resolveTurnScopeId(),
            }),
          );
          return;
        }
        sendEvent("delta", {
          text: String(eventData.text || ""),
          dialogProcessId: String(eventData?.dialogProcessId || ""),
          sessionId: String(sessionId || ""),
          turnScopeId: eventData?.turnScopeId || resolveTurnScopeId(),
        });
        return;
      }
      if (eventName === "attachment_parsed") {
        const parentOwnedData = childRunEvent
          ? parentOwnsChildRunEventData(eventData, {
              rootSessionId: sessionId,
              parentDialogProcessId,
            })
          : eventData;
        sendEvent("attachment_parsed", {
          ...parentOwnedData,
          sessionId: String(sessionId || ""),
          turnScopeId: resolveTurnScopeId(),
          attachments: Array.isArray(eventData?.attachments) ? eventData.attachments : [],
        });
        return;
      }
      if (
        eventName === "attachments_saved" ||
        eventName === "model_generated_attachments_saved"
      ) {
        const parentOwnedData = childRunEvent
          ? parentOwnsChildRunEventData(eventData, {
              rootSessionId: sessionId,
              parentDialogProcessId,
            })
          : eventData;
        const attachments = Array.isArray(eventData?.attachments)
          ? eventData.attachments
          : [];
        sendEvent("attachments", {
          ...parentOwnedData,
          dialogProcessId: String(parentOwnedData?.dialogProcessId || ""),
          sessionId: String(sessionId || ""),
          turnScopeId: resolveTurnScopeId(),
          attachments,
        });
        return;
      }
      const normalizedEvent = normalizeSseLogEvent(
        childRunEvent
          ? {
              ...eventPayload,
              data: parentOwnsChildRunEventData(eventData, {
                rootSessionId: sessionId,
                parentDialogProcessId,
              }),
            }
          : eventPayload,
      );
      if (childRunEvent) {
        const parentOwnedData = parentOwnsChildRunEventData(eventData, {
          rootSessionId: sessionId,
          parentDialogProcessId,
        });
        sendEvent(
          normalizedEvent.event,
          buildParentOwnedChildRunPayload(normalizedEvent.data, parentOwnedData, {
            rootSessionId: sessionId,
            turnScopeId: resolveTurnScopeId(),
          }),
        );
        return;
      }
      sendEvent(normalizedEvent.event, normalizedEvent.data);
    },
  };
}
