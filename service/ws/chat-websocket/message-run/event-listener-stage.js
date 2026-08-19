/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { TURN_EVENT, TURN_PHASE, createTurnLifecycleCommandId } from "@noobot/session-protocol";
import { publishRunEvent, registerActiveRun } from "../run-registry.js";
import { createRunEventListener } from "../run-event-listener.js";
import {
  recordServiceAgentTransportDebug,
  recordServiceWebSocketLifecycle,
} from "../runtime-events.js";

const text = (value) => String(value || "").trim();
const TIMELINE_EVENT_TYPES = new Set([
  "tool_call_start",
  "tool_call_end",
  "main_model_content",
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

function onEventReceived(context, command, run, eventData = {}) {
  const eventType = text(eventData.eventType || eventData.eventName);
  if (eventType === "agent_transport_parameters_consumed") {
    void recordServiceAgentTransportDebug({
      sessionLogConfig: context.sessionLogConfig,
      event: "agent.agentTransport.parametersConsumed",
      command,
      userId: run.userId,
      data: {
        consumed: true,
        transport: "websocket",
        consumer: "agent",
        consumption: eventData.agentTransportConsumption || {},
      },
    });
    return;
  }
  if (
    eventType === "workflow_planning_message_prepared" ||
    eventType === "workflow_node_state_committed"
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
  const dispatch = await context.dispatchAuthorityEvents?.(
    {
      userId: run.userId,
      sessionId: envelope.identity.sessionId,
      parentSessionId: envelope.payload.parentSessionId,
      persistenceScope: dispatchContext.persistenceScope,
    },
    (...args) => publishRunEvent(active.runHandle, ...args),
  );
  if (dispatch?.dispatched !== true)
    throw new Error(dispatch?.reason || "authority_event_dispatch_failed");
  return dispatch;
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

export function createMessageRunEventListener(context, command, run, accepted, active) {
  const lifecycle = { processingStarted: null };
  const eventListener = createRunEventListener({
    sendEvent: (...args) => publishRunEvent(active.runHandle, ...args),
    sessionId: run.sessionId,
    registerActiveRun,
    getCurrentRunMeta: () => active.runMeta,
    getCurrentRunHandle: () => active.runHandle,
    getCurrentTurnScopeId: () => active.runMeta.turnScopeId,
    onEventReceived: (eventData) => onEventReceived(context, command, run, eventData),
    onCommittedTurnLifecycle: (envelope, dispatchContext) =>
      dispatchCommittedTurn(context, run, envelope, dispatchContext),
    onAuthorityEventCommitted: (envelope, dispatchContext) =>
      dispatchAuthorityEvent(context, run, active, envelope, dispatchContext),
    onRootRunning: createRootRunningHandler(context, run, accepted, lifecycle),
  });
  return { eventListener, lifecycle };
}
