/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  MESSAGE_EVENT_ENVELOPE_KIND,
  assertMessageEventEnvelope,
  isMessageEventEnvelope,
  normalizeSseLogEvent,
} from "#agent/event";
import {
  buildParentOwnedChildRunPayload,
  buildAuthoritativeMessagePacket,
  buildSubSessionWirePayload,
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
  onCommittedTurnLifecycle = null,
  onAuthoritativeMessageRouted = null,
  onEventReceived = null,
} = {}) {
  const resolveTurnScopeId = () =>
    getCurrentRunMeta()?.turnScopeId || getCurrentTurnScopeId() || "";

  return {
    onEvent: (eventPayload) => {
      const eventName = eventPayload?.event || "thinking";
      const eventData = eventPayload?.data || {};
      onEventReceived?.({
        eventName,
        eventType: String(eventData?.eventType || "").trim(),
        sessionId: String(eventData?.sessionId || sessionId || "").trim(),
        dialogProcessId: String(eventData?.dialogProcessId || "").trim(),
        turnScopeId: String(eventData?.turnScopeId || resolveTurnScopeId() || "").trim(),
        envelopeKind: String(eventData?.envelopeKind || "").trim(),
        messageId: String(eventData?.messageId || "").trim(),
        sequence: Number(eventData?.sequence || 0),
        hasTool: Boolean(eventData?.tool),
        hasResult: eventData?.result !== undefined,
        dataKeys: Object.keys(eventData).sort(),
      });
      const eventDialogProcessId = String(eventData?.dialogProcessId || "").trim();
      const currentRunMeta = getCurrentRunMeta();
      const currentRunHandle = getCurrentRunHandle();
      const parentDialogProcessId =
        currentRunMeta?.dialogProcessId ||
        eventData?.parentDialogProcessId ||
        currentRunMeta?.parentDialogProcessId ||
        "";
      if (eventName === "turn_lifecycle_committed") {
        if (typeof onCommittedTurnLifecycle === "function") {
          onCommittedTurnLifecycle(eventData);
        }
        return;
      }
      const childRunEvent = isChildRunEventData(eventData, {
        rootSessionId: sessionId,
      });
      const workflowChildRunEvent = Boolean(
        childRunEvent && (eventData?.workflowRunId || eventData?.nodeExecutionId),
      );
      // A producer that marks an event as authoritative must satisfy the whole
      // contract. Do not silently downgrade malformed envelopes into the
      // legacy normalization path: that would reintroduce inferred identity.
      if (eventData?.envelopeKind === MESSAGE_EVENT_ENVELOPE_KIND) {
        assertMessageEventEnvelope(eventData);
      }
      // Authoritative message envelopes are already the wire contract. Never
      // normalize, classify, or reconstruct them here: doing so can silently
      // sever message/tool identity. Transport layers may add scope aliases,
      // but the envelope itself remains the single source of truth.
      if (isMessageEventEnvelope(eventData)) {
        if (eventName === "llm_delta" && !textStreamingEnabled) return;
        const authoritativeSessionId = String(eventData?.sessionId || "").trim();
        const rootSessionId = String(sessionId || "").trim();
        const authoritativeScope = authoritativeSessionId === rootSessionId
          ? "main_session"
          : "sub_session";
        const routedEventName = authoritativeScope === "main_session"
          ? "message_event"
          : "subagent_message_event";
        onAuthoritativeMessageRouted?.({
          routedEventName,
          authoritativeScope,
          rootSessionId,
          sessionId: authoritativeSessionId,
          parentSessionId: String(eventData?.parentSessionId || "").trim(),
          dialogProcessId: String(eventData?.dialogProcessId || "").trim(),
          parentDialogProcessId: String(parentDialogProcessId || "").trim(),
          turnScopeId: String(eventData?.turnScopeId || "").trim(),
          eventType: String(eventData?.eventType || "").trim(),
          messageId: String(eventData?.messageId || "").trim(),
          workflowRunId: String(eventData?.workflowRunId || "").trim(),
          nodeExecutionId: String(eventData?.nodeExecutionId || "").trim(),
          hasContent: Boolean(eventData?.content || eventData?.delta || eventData?.text),
          hasTool: Boolean(eventData?.tool),
          hasResult: eventData?.result !== undefined,
        });
        // The authoritative event is an immutable inner contract. Transport
        // scope lives beside it and can never overwrite message identity.
        sendEvent(
          routedEventName,
          buildAuthoritativeMessagePacket(eventData, {
          rootSessionId: sessionId,
          parentDialogProcessId,
          scope: authoritativeScope,
          }),
        );
        return;
      }
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
        if (workflowChildRunEvent) {
          sendEvent("subagent_delta", buildSubSessionWirePayload({
            ...eventData,
            content: String(eventData.text || ""),
            delta: String(eventData.text || ""),
          }, {
            rootSessionId: sessionId,
            parentDialogProcessId,
            turnScopeId: resolveTurnScopeId(),
          }));
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
      if (typeof eventName === "string" && eventName.startsWith("workflow_")) {
        sendEvent(eventName, {
          ...eventData,
          sessionId: String(eventData?.sessionId || sessionId || ""),
          turnScopeId: eventData?.turnScopeId || resolveTurnScopeId(),
        });
        return;
      }
      if (workflowChildRunEvent) {
        const normalizedEvent = normalizeSseLogEvent(eventPayload);
        const normalizedType = String(normalizedEvent?.data?.type || eventName || "event")
          .trim()
          .replace(/^subagent_/, "")
          .replace(/[^a-zA-Z0-9_]+/g, "_");
        sendEvent(`subagent_${normalizedType || "event"}`, buildSubSessionWirePayload({
          ...eventData,
          ...normalizedEvent.data,
          rawEvent: eventName,
        }, {
          rootSessionId: sessionId,
          parentDialogProcessId,
          turnScopeId: resolveTurnScopeId(),
        }));
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
