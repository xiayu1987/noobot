/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { TURN_EVENT, TURN_PHASE, createTurnLifecycleCommandId } from "@noobot/session-protocol";
import { isTransientMessageEvent } from "@noobot/event-protocol/message-event";
import { WORKFLOW_RUNTIME_EVENT } from "@noobot/event-protocol/workflow-runtime-event";
import { publishRunEvent, registerActiveRun } from "../run-registry.js";
import { createRunEventListener } from "../run-event-listener.js";
import { isSessionLogDebugTypeEnabled } from "@noobot/runtime-events/session-log-protocol";
import { recordServiceWebSocketLifecycle } from "../runtime-events.js";

const text = (value) => String(value || "").trim();
const REPLAYABLE_DISPATCH_FAILURES = new Set(["authority_event_send_failed"]);
const TIMELINE_EVENT_TYPES = new Set([
  "tool_call_start",
  "tool_call_end",
  "guidance_analysis_response",
  "guidance_analysis",
  "timeline_checkpoint_persisted",
]);

function recordTimelineEvent(context, run, eventData, eventType) {
  if (!TIMELINE_EVENT_TYPES.has(eventType)) return;
  const guidance = eventType === "guidance_analysis_response" || eventType === "guidance_analysis";
  void recordServiceWebSocketLifecycle({
    sessionLogConfig: context.sessionLogConfig,
    category: "debug",
    level: "debug",
    debugType: "timeline-pipeline",
    event:
      eventType === "timeline_checkpoint_persisted"
        ? "service.timelinePipeline.checkpointPersisted"
        : guidance
          ? "service.timelinePipeline.activityReceived"
          : "service.websocket.runEvent.timelineReceived",
    userId: run.userId,
    sessionId: eventData.sessionId || run.sessionId,
    dialogProcessId:
      eventData.dialogProcessId || context.state.currentRunMeta?.dialogProcessId || "",
    turnScopeId: eventData.turnScopeId || context.state.currentTurnScopeId || "",
    data: eventData,
  });
}

function onEventReceived(context, run, eventData = {}) {
  const eventType = text(eventData.eventType || eventData.eventName);
  if (
    eventType === WORKFLOW_RUNTIME_EVENT.PLANNING ||
    eventType === WORKFLOW_RUNTIME_EVENT.NODE_STATE
  ) {
    void recordServiceWebSocketLifecycle({
      sessionLogConfig: context.sessionLogConfig,
      category: "debug",
      level: "debug",
      debugType: "workflow-diagnostics",
      event: "service.workflowTransport.sourceEventReceived",
      userId: run.userId,
      sessionId: eventData.sessionId || run.sessionId,
      dialogProcessId:
        eventData.dialogProcessId || context.state.currentRunMeta?.dialogProcessId || "",
      turnScopeId: eventData.turnScopeId || context.state.currentTurnScopeId || "",
      data: eventData,
    });
    return;
  }
  recordTimelineEvent(context, run, eventData, eventType);
}

function recordDispatchFailure(
  context,
  run,
  committedEnvelope,
  dispatchContext,
  reason,
  delivered = 0,
) {
  const identity = committedEnvelope.identity || {};
  const payload = committedEnvelope.payload || {};
  void recordServiceWebSocketLifecycle({
    sessionLogConfig: context.sessionLogConfig,
    event: "service.authorityOutbox.dispatchFailed",
    userId: run.userId,
    sessionId: run.sessionId,
    dialogProcessId: context.state.currentRunMeta?.dialogProcessId || "",
    turnScopeId: identity.turnScopeId || "",
    data: {
      childSessionId: identity.sessionId || "",
      parentSessionId: payload.parentSessionId || "",
      persistenceScopeId: dispatchContext.persistenceScope?.scopeId || "",
      lifecycleEventType: payload.eventType || "",
      reason,
      delivered: Number(delivered || 0),
    },
  });
}

async function dispatchCommittedTurn(context, run, envelope = {}, dispatchContext = {}) {
  const identity = envelope.identity || {};
  const payload = envelope.payload || {};
  try {
    const dispatch = await context.dispatchAuthorityEvents?.({
      userId: payload.userId,
      sessionId: identity.sessionId,
      parentSessionId: payload.parentSessionId,
      persistenceScope: dispatchContext.persistenceScope,
    });
    if (dispatch?.dispatched !== true) {
      recordDispatchFailure(
        context,
        run,
        envelope,
        dispatchContext,
        dispatch?.reason || "authority_dispatcher_unavailable",
        dispatch?.delivered,
      );
    }
    return dispatch;
  } catch (error) {
    const reason = error?.message || "authority_dispatch_failed";
    recordDispatchFailure(context, run, envelope, dispatchContext, reason);
    return { dispatched: false, reason, delivered: 0 };
  }
}

async function dispatchAuthorityEvent(context, run, active, envelope = {}, dispatchContext = {}) {
  if (isTransientMessageEvent(envelope)) {
    const sent = await publishRunEvent(active.runHandle, envelope.identity.eventType, envelope);
    return { dispatched: true, delivered: sent === true ? 1 : 0 };
  }
  const dispatch = await context.dispatchAuthorityEvents?.(
    {
      userId: run.userId,
      sessionId: envelope.identity.sessionId,
      parentSessionId: envelope.payload.parentSessionId,
      persistenceScope: dispatchContext.persistenceScope,
    },
    (...args) => publishRunEvent(active.runHandle, ...args),
  );
  if (dispatch?.dispatched === true) return dispatch;
  const reason = dispatch?.reason || "authority_event_dispatch_failed";
  if (!REPLAYABLE_DISPATCH_FAILURES.has(reason)) throw new Error(reason);
  recordDispatchFailure(context, run, envelope, dispatchContext, reason, dispatch?.delivered);
  return { ...dispatch, deliveryDegraded: true };
}

function startProcessing(context, run, accepted, lifecycleData) {
  return context
    .commitTurnLifecycle({
      userId: run.userId,
      sessionId: run.sessionId,
      parentSessionId: run.parentSessionId,
      turnScopeId: context.state.currentTurnScopeId,
      dialogProcessId:
        lifecycleData?.dialogProcessId ||
        context.state.currentRunMeta?.dialogProcessId ||
        run.dialogProcessId,
      commandId: createTurnLifecycleCommandId({
        commandId: accepted.commandId,
        eventType: TURN_EVENT.PROCESSING_STARTED,
        phase: TURN_PHASE.PROCESSING,
      }),
      causationId: accepted.commandId,
      eventType: TURN_EVENT.PROCESSING_STARTED,
      phase: TURN_PHASE.PROCESSING,
      executionState: "sending",
      executionId: lifecycleData?.executionId,
      executionKind: lifecycleData?.executionKind,
      parentExecutionId: lifecycleData?.parentExecutionId,
      rootExecutionId: lifecycleData?.rootExecutionId,
      origin: lifecycleData?.origin,
      stage: lifecycleData?.stage,
    })
    .then((started) => {
      if (!started?.applied && !started?.deduplicated) {
        const code = text(started?.reason || "processing_start_failed");
        throw Object.assign(new Error(code), { code });
      }
      context.lifecycle.latestTurn = started.turn || context.lifecycle.latestTurn;
      context.state.currentLifecyclePhase = TURN_PHASE.PROCESSING;
      return started;
    });
}

function createRootRunningHandler(context, run, accepted, lifecycle) {
  return (lifecycleData) => {
    if (lifecycle.processingStarted) return lifecycle.processingStarted;
    lifecycle.processingStarted = startProcessing(context, run, accepted, lifecycleData);
    context.lifecycle.pending = lifecycle.processingStarted;
    void lifecycle.processingStarted.catch((error) => {
      void recordServiceWebSocketLifecycle({
        sessionLogConfig: context.sessionLogConfig,
        event: "service.websocket.processingStart.persistenceFailed",
        userId: run.userId,
        sessionId: run.sessionId,
        dialogProcessId: lifecycleData?.dialogProcessId || "",
        turnScopeId: context.state.currentTurnScopeId,
        data: { errorType: error?.name || "Error", errorCode: text(error?.code) },
      });
    });
    return lifecycle.processingStarted;
  };
}

const DELIVERY_TIMING_DEBUG_TYPE = "delivery-timing";

function recordDeliveryTiming(context, run, active, summary) {
  void recordServiceWebSocketLifecycle({
    sessionLogConfig: context.sessionLogConfig,
    category: "debug",
    level: "debug",
    debugType: DELIVERY_TIMING_DEBUG_TYPE,
    event: "service.websocket.upstreamDelivery.timing",
    userId: run.userId,
    sessionId: summary.sessionId || run.sessionId,
    dialogProcessId: summary.dialogProcessId || active.runMeta?.dialogProcessId || "",
    turnScopeId: summary.turnScopeId || active.runMeta?.turnScopeId || "",
    data: { queueWaitMs: summary.queueWaitMs, runMs: summary.runMs },
  });
}

export function createMessageRunEventListener(context, run, accepted, active) {
  const lifecycle = { processingStarted: null };
  const eventListener = createRunEventListener({
    sendEvent: (...args) => publishRunEvent(active.runHandle, ...args),
    sessionId: run.sessionId,
    registerActiveRun,
    getCurrentRunMeta: () => active.runMeta,
    getCurrentRunHandle: () => active.runHandle,
    getCurrentTurnScopeId: () => active.runMeta.turnScopeId,
    onEventReceived: (eventData) => onEventReceived(context, run, eventData),
    onDeliveryTiming: isSessionLogDebugTypeEnabled(
      DELIVERY_TIMING_DEBUG_TYPE,
      context.sessionLogConfig,
    )
      ? (summary = {}) => recordDeliveryTiming(context, run, active, summary)
      : null,
    onCommittedTurnLifecycle: (envelope, dispatchContext) =>
      dispatchCommittedTurn(context, run, envelope, dispatchContext),
    onAuthorityEventCommitted: (envelope, dispatchContext) =>
      dispatchAuthorityEvent(context, run, active, envelope, dispatchContext),
    onRootRunning: createRootRunningHandler(context, run, accepted, lifecycle),
  });
  return { eventListener, lifecycle };
}
