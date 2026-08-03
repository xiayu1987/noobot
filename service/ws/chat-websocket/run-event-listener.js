/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  MESSAGE_EVENT_ENVELOPE_KIND,
  assertMessageEventEnvelope,
  isMessageEventEnvelope,
} from "#agent/event";
import {
  buildParentOwnedChildRunPayload,
  buildAuthoritativeMessagePacket,
  buildSubSessionWirePayload,
  isChildRunEventData,
  parentOwnsChildRunEventData,
} from "./child-run-events.js";

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
  const subagentEventName = (value = "") => {
    const normalized = String(value || "event")
      .trim()
      .replace(/^subagent_/, "")
      .replace(/[^a-zA-Z0-9_]+/g, "_");
    return `subagent_${normalized || "event"}`;
  };
  const resolveTurnScopeId = () =>
    getCurrentRunMeta()?.turnScopeId || getCurrentTurnScopeId() || "";

  const deliverAuthoritativeMessage = (eventName, packet, routeData) => {
    try {
      const delivery = sendEvent(eventName, packet);
      if (delivery && typeof delivery.then === "function") {
        return delivery.then(
          (delivered) => {
            onAuthoritativeMessageRouted?.({
              ...routeData,
              delivery: delivered === true ? "delivered" : "rejected",
              rejectionReason: delivered === true ? "" : "transport_send_rejected",
            });
            return delivered;
          },
          (error) => {
            onAuthoritativeMessageRouted?.({
              ...routeData,
              delivery: "failed",
              rejectionReason: error?.message || String(error || "transport_send_failed"),
            });
            throw error;
          },
        );
      }
      onAuthoritativeMessageRouted?.({
        ...routeData,
        delivery: delivery === true ? "delivered" : "rejected",
        rejectionReason: delivery === true ? "" : "transport_send_rejected",
      });
      return delivery;
    } catch (error) {
      onAuthoritativeMessageRouted?.({
        ...routeData,
        delivery: "failed",
        rejectionReason: error?.message || String(error || "transport_send_failed"),
      });
      throw error;
    }
  };

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
        presentationMessageId: String(eventData?.presentationMessageId || "").trim(),
        eventId: String(eventData?.eventId || "").trim(),
        messageCount: Number(eventData?.messageCount || 0),
        assistantCount: Number(eventData?.assistantCount || 0),
        toolCount: Number(eventData?.toolCount || 0),
        activityTimelineCount: Number(eventData?.activityTimelineCount || 0),
        messages: Array.isArray(eventData?.messages)
          ? eventData.messages.slice(0, 64).map((message = {}) => ({
              messageUid: String(message?.messageUid || "").trim(),
              messageId: String(message?.messageId || "").trim(),
              presentationMessageId: String(message?.presentationMessageId || "").trim(),
              role: String(message?.role || "").trim(),
              type: String(message?.type || "").trim(),
              activityTimelineCount: Number(message?.activityTimelineCount || 0),
              activityTimeline: Array.isArray(message?.activityTimeline)
                ? message.activityTimeline.slice(0, 64).map((activity = {}) => ({
                    eventId: String(activity?.eventId || "").trim(),
                    activityKind: String(activity?.activityKind || "").trim(),
                    sequence: Number(activity?.sequence || 0),
                    sequenceDomain: String(activity?.sequenceDomain || "").trim(),
                    sequenceScopeId: String(activity?.sequenceScopeId || "").trim(),
                    authority: String(activity?.authority || "").trim(),
                  }))
                : [],
            }))
          : [],
        workflowRunId: String(eventData?.workflowRunId || "").trim(),
        nodeExecutionId: String(eventData?.nodeExecutionId || "").trim(),
        workflowStatus: String(eventData?.status || "").trim(),
        workflowRevision: Number(eventData?.revision || 0),
        workflowSequence: Number(eventData?.sequence || 0),
        nodeSessionCount: Array.isArray(eventData?.nodeSessions) ? eventData.nodeSessions.length : 0,
        semanticTextLength: String(eventData?.semanticText || "").length,
        sourceMessage: eventData?.sourceMessage && typeof eventData.sourceMessage === "object"
          ? eventData.sourceMessage
          : null,
        sequence: Number(eventData?.sequence || 0),
        sequenceDomain: String(eventData?.sequenceDomain || "").trim(),
        sequenceScopeId: String(eventData?.sequenceScopeId || eventData?.messageId || "").trim(),
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
          return onCommittedTurnLifecycle(
            eventData?.envelope || eventData,
          );
        }
        return;
      }
      if (eventName === "turn_committed") {
        return sendEvent("turn_committed", {
          ...eventData,
          sessionId: String(eventData?.sessionId || sessionId || "").trim(),
          turnScopeId: String(eventData?.turnScopeId || resolveTurnScopeId() || "").trim(),
        });
        return;
      }
      const childRunEvent = isChildRunEventData(eventData, {
        rootSessionId: sessionId,
      });
      const workflowChildRunEvent = Boolean(
        childRunEvent && (eventData?.workflowRunId || eventData?.nodeExecutionId),
      );
      if (eventData?.envelopeKind === MESSAGE_EVENT_ENVELOPE_KIND) {
        assertMessageEventEnvelope(eventData);
      }
      if (isMessageEventEnvelope(eventData)) {
        const authoritativeSessionId = String(eventData?.sessionId || "").trim();
        const rootSessionId = String(sessionId || "").trim();
        const authoritativeScope = authoritativeSessionId === rootSessionId
          ? "main_session"
          : "sub_session";
        const routedEventName = authoritativeScope === "main_session"
          ? "message_event"
          : "subagent_message_event";
        const authoritativeEventType = String(eventData?.eventType || eventName || "").trim();
        const suppressed = authoritativeEventType === "llm_delta" && !textStreamingEnabled;
        const routeData = {
          routedEventName,
          authoritativeScope,
          rootSessionId,
          sessionId: authoritativeSessionId,
          parentSessionId: String(eventData?.parentSessionId || "").trim(),
          dialogProcessId: String(eventData?.dialogProcessId || "").trim(),
          parentDialogProcessId: String(parentDialogProcessId || "").trim(),
          turnScopeId: String(eventData?.turnScopeId || "").trim(),
          eventType: authoritativeEventType,
          eventId: String(eventData?.eventId || "").trim(),
          messageId: String(eventData?.messageId || "").trim(),
          presentationMessageId: String(eventData?.presentationMessageId || "").trim(),
          sequence: Number(eventData?.sequence || 0),
          sequenceDomain: String(eventData?.sequenceDomain || "").trim(),
          sequenceScopeId: String(eventData?.sequenceScopeId || eventData?.messageId || "").trim(),
          textStreamingEnabled: Boolean(textStreamingEnabled),
          delivery: suppressed ? "suppressed" : "pending",
          suppressionReason: suppressed ? "non_streaming_delta" : "",
          workflowRunId: String(eventData?.workflowRunId || "").trim(),
          nodeExecutionId: String(eventData?.nodeExecutionId || "").trim(),
          hasContent: Boolean(eventData?.content || eventData?.delta || eventData?.text),
          contentLength: String(eventData?.text || eventData?.content || "").length,
          attachmentCount: Array.isArray(eventData?.attachments) ? eventData.attachments.length : 0,
          transferEnvelopeCount: Array.isArray(eventData?.transferEnvelopes)
            ? eventData.transferEnvelopes.length
            : 0,
          hasTool: Boolean(eventData?.tool),
          hasResult: eventData?.result !== undefined,
        };
        if (suppressed) {
          onAuthoritativeMessageRouted?.(routeData);
          return true;
        }
        return deliverAuthoritativeMessage(
          routedEventName,
          buildAuthoritativeMessagePacket(eventData, {
            rootSessionId: sessionId,
            parentDialogProcessId,
            scope: authoritativeScope,
          }),
          routeData,
        );
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
          return;
        }
        if (workflowChildRunEvent) {
          return sendEvent("subagent_delta", buildSubSessionWirePayload({
            ...eventData,
            content: String(eventData.text || ""),
            delta: String(eventData.text || ""),
          }, {
            rootSessionId: sessionId,
            parentDialogProcessId,
            turnScopeId: resolveTurnScopeId(),
          }));
        }
        if (childRunEvent) {
          const parentOwnedData = parentOwnsChildRunEventData(eventData, {
            rootSessionId: sessionId,
            parentDialogProcessId,
          });
          return sendEvent(
            "subagent_llm_delta",
            buildParentOwnedChildRunPayload({
              ...parentOwnedData,
              text: String(parentOwnedData.text || ""),
            }, parentOwnedData, {
              rootSessionId: sessionId,
              turnScopeId: resolveTurnScopeId(),
            }),
          );
        }
        return sendEvent("delta", {
          text: String(eventData.text || ""),
          dialogProcessId: String(eventData?.dialogProcessId || ""),
          sessionId: String(sessionId || ""),
          turnScopeId: eventData?.turnScopeId || resolveTurnScopeId(),
        });
      }
      if (eventName === "attachment_parsed") {
        const parentOwnedData = childRunEvent
          ? parentOwnsChildRunEventData(eventData, {
              rootSessionId: sessionId,
              parentDialogProcessId,
            })
          : eventData;
        return sendEvent("attachment_parsed", {
          ...parentOwnedData,
          sessionId: String(sessionId || ""),
          turnScopeId: resolveTurnScopeId(),
          attachments: Array.isArray(eventData?.attachments) ? eventData.attachments : [],
        });
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
        return sendEvent("attachments", {
          ...parentOwnedData,
          dialogProcessId: String(parentOwnedData?.dialogProcessId || ""),
          sessionId: String(sessionId || ""),
          turnScopeId: resolveTurnScopeId(),
          attachments,
        });
      }
      if (typeof eventName === "string" && eventName.startsWith("workflow_")) {
        return sendEvent(eventName, {
          ...eventData,
          sessionId: String(eventData?.sessionId || sessionId || ""),
          turnScopeId: eventData?.turnScopeId || resolveTurnScopeId(),
        });
      }
      if (workflowChildRunEvent) {
        return sendEvent(subagentEventName(eventName), buildSubSessionWirePayload({
          ...eventData,
          rawEvent: eventName,
        }, {
          rootSessionId: sessionId,
          parentDialogProcessId,
          turnScopeId: resolveTurnScopeId(),
        }));
      }
      if (childRunEvent) {
        const parentOwnedData = parentOwnsChildRunEventData(eventData, {
          rootSessionId: sessionId,
          parentDialogProcessId,
        });
        return sendEvent(
          subagentEventName(eventName),
          buildParentOwnedChildRunPayload(parentOwnedData, parentOwnedData, {
            rootSessionId: sessionId,
            turnScopeId: resolveTurnScopeId(),
          }),
        );
      }
      return sendEvent(eventName, {
        ...eventData,
        sessionId: String(eventData?.sessionId || sessionId || ""),
        turnScopeId: String(eventData?.turnScopeId || resolveTurnScopeId() || ""),
      });
    },
  };
}
