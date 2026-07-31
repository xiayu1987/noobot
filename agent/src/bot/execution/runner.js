/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { emitEvent } from "../../events/index.js";
import {
  isActivityMessageEvent,
  isToolMessageEvent,
  reduceCanonicalToolTimeline,
} from "../../events/canonical-message-timeline.js";
import { tSystem } from "noobot-i18n/agent/system-text";
import { isAbortError, isUserStopAbort, resolveAbortStopType } from "../../shared/utils/error-utils.js";
import {
  BOT_HOOK_POINTS,
  runBotRuntimeHook,
  withBotHookRuntimeMeta,
} from "../hook/index.js";
import {
  BOT_MANAGE_LOG_EVENT,
  BOT_MANAGE_LOG_SOURCE,
  CALLER_ROLE,
  MESSAGE_ROLE,
  MESSAGE_TYPE,
  SESSION_ASYNC_STATUS,
} from "../config/constants.js";
import { resolveDialogProcessIdFromContext } from "../../context/session/dialog-process-id-resolver.js";
import {
  getDialogProcessIdFromAgentContext,
  getRuntimeFromAgentContext,
  getSystemRuntimeFromAgentContext,
} from "../../context/agent-context-accessor.js";
import { resolveParentSessionId } from "../../context/parent-session-id-resolver.js";
import {
  getAgentContextCompatFieldHitStats,
  resetAgentContextCompatFieldHitStats,
} from "../../context/compatibility-deprecation.js";
import { applyRuntimeUserMessageAttachments } from "../../artifacts/index.js";
import {
  bindLifecycleToRuntime,
  createAgentLifecycleMachine,
  resolveInitialLifecycleState,
  syncLifecycleRuntimeState,
} from "../../runtime/lifecycle/state-machine.js";
import { saveStoppedModelMessageSnapshotCandidate } from "../../runtime/resume/model-message-snapshot-store.js";
import { createTurnCommand, resolveRunTurnScopeId, toCommitTurnPayload } from "./turn-command.js";
import { summarizeDebugAttachments, readSelectedModelValue } from "./runner/debug-utils.js";
import { buildSessionRuntimePluginResolvedEvent } from "./runner/plugin-runtime.js";
import { dispatchAgentTurn } from "./runner/agent-dispatch.js";
import { finalizeAgentTurn } from "./runner/result-finalizer.js";
import { bindAssistantMessageEventStream } from "../../events/message-event-stream.js";

function currentTurnMessageCheckpointKey(message = {}, index = 0) {
  const messageUid = String(message?.messageUid || "").trim();
  if (messageUid) return `uid:${messageUid}`;
  const messageId = String(message?.messageId || message?.id || "").trim();
  const dialogProcessId = String(message?.dialogProcessId || "").trim();
  const turnScopeId = String(message?.turnScopeId || "").trim();
  if (messageId) return `message:${dialogProcessId}:${turnScopeId}:${messageId}`;
  return `index:${index}:${String(message?.role || "")}:${String(message?.tool_call_id || "")}`;
}

function currentTurnMessageCheckpointFingerprint(message = {}) {
  try {
    return JSON.stringify(message);
  } catch {
    return null;
  }
}

function buildCurrentTurnCheckpointEntries(messages = []) {
  return messages.map((message, index) => ({
    key: currentTurnMessageCheckpointKey(message, index),
    fingerprint: currentTurnMessageCheckpointFingerprint(message),
    message,
  }));
}

export class SessionExecutionRunner {
  constructor({
    agentRunner,
    errorLogger,
    normalizeRunMessage,
    validateRunInput,
    ensureParentAsyncResultContainer,
    initializeRunSessionRuntime,
    resolveScenarioRunConfig,
    prepareRunConfig,
    prepareTurnInput,
    prepareAgentTurnExecution,
    commitSummaryCheckpoint,
    appendAgentMessages,
    appendSessionTurn,
    assertPersistenceContextIdentity,
    commitSessionTurn,
    stampReusedUserTurnDialogProcessId,
    getSessionTurns,
    getTurnSummaryCheckpointState,
    finalizeRunSession,
    upsertParentAsyncTask,
    now,
  } = {}) {
    this.agentRunner = agentRunner;
    this.errorLogger = errorLogger;
    this.normalizeRunMessage = normalizeRunMessage;
    this.validateRunInput = validateRunInput;
    this.ensureParentAsyncResultContainer = ensureParentAsyncResultContainer;
    this.initializeRunSessionRuntime = initializeRunSessionRuntime;
    this.resolveScenarioRunConfig = resolveScenarioRunConfig;
    this.prepareRunConfig = prepareRunConfig;
    this.prepareTurnInput = prepareTurnInput;
    this.prepareAgentTurnExecution = prepareAgentTurnExecution;
    this.commitSummaryCheckpoint = commitSummaryCheckpoint;
    this.appendAgentMessages = appendAgentMessages;
    this.appendSessionTurn = appendSessionTurn;
    this.assertPersistenceContextIdentity = assertPersistenceContextIdentity;
    this.commitSessionTurn = commitSessionTurn;
    this.stampReusedUserTurnDialogProcessId = stampReusedUserTurnDialogProcessId;
    this.getSessionTurns = getSessionTurns;
    this.getTurnSummaryCheckpointState = getTurnSummaryCheckpointState;
    this.finalizeRunSession = finalizeRunSession;
    this.upsertParentAsyncTask = upsertParentAsyncTask;
    this.now = now;
  }

  _normalizePreparedAgentTurnExecution(prepared = {}) {
    const safePrepared = prepared && typeof prepared === "object" ? prepared : {};
    const agentContext =
      safePrepared?.agentContext && typeof safePrepared.agentContext === "object"
        ? safePrepared.agentContext
        : {};
    const runtimeAgentContext =
      safePrepared?.runtimeAgentContext && typeof safePrepared.runtimeAgentContext === "object"
        ? safePrepared.runtimeAgentContext
        : agentContext;
    const userMessageAttachments = Array.isArray(safePrepared?.userMessageAttachments)
      ? safePrepared.userMessageAttachments
      : [];
    return {
      agentContext,
      runtimeAgentContext,
      userMessageAttachments,
    };
  }

  _buildAgentContextSummary(agentContext = {}) {
    const runtime = getRuntimeFromAgentContext(agentContext);
    const systemRuntime = getSystemRuntimeFromAgentContext(agentContext, runtime);
    const messagesHistory = Array.isArray(agentContext?.payload?.messages?.history)
      ? agentContext.payload.messages.history
      : [];
    const toolRegistry = Array.isArray(agentContext?.payload?.tools?.registry)
      ? agentContext.payload.tools.registry
      : [];
    const userMessageAttachments = Array.isArray(runtime?.userMessageAttachments)
      ? runtime.userMessageAttachments
      : [];
    const runtimeAttachments = Array.isArray(runtime?.attachments)
      ? runtime.attachments
      : [];
    return {
      userId: String(systemRuntime?.userId || "").trim(),
      sessionId: String(systemRuntime?.sessionId || "").trim(),
      parentSessionId: resolveParentSessionId({ runtime }),
      dialogProcessId:
        getDialogProcessIdFromAgentContext(agentContext, runtime) ||
        resolveDialogProcessIdFromContext({ runtime }),
      caller: String(systemRuntime?.caller || "").trim(),
      runtimeModel: String(runtime?.runtimeModel || "").trim(),
      messageCount: messagesHistory.length,
      toolCount: toolRegistry.length,
      attachmentCount: userMessageAttachments.length + runtimeAttachments.length,
      hasAbortSignal: Boolean(runtime?.abortSignal),
    };
  }

  async runSession({
    userId,
    sessionId,
    message,
    attachments = [],
    systemMessages = [],
    eventListener = null,
    caller = CALLER_ROLE.USER,
    parentSessionId = "",
    parentDialogProcessId = "",
    dialogProcessId: requestedDialogProcessId = "",
    abortSignal = null,
    userInteractionBridge = null,
    runConfig = {},
    turnScopeId = "",
    parentAsyncResultContainer = null,
    persistenceContext = null,
  }) {
    this.assertPersistenceContextIdentity?.(persistenceContext, {
      userId,
      sessionId,
      parentSessionId,
      scopeId: String(runConfig?.executionId || "").trim(),
    });
    let resolvedParentAsyncResultContainer = parentAsyncResultContainer;
    let resolvedRunConfig = runConfig;
    let resolvedUsedSessionId = sessionId;
    let resolvedDialogProcessId = parentDialogProcessId;
    let resolvedRuntimeEventListener = eventListener;
    let lifecycle = null;
    let lifecycleRuntime = null;
    let stoppedSnapshotPersistencePromise = null;
    let stoppedSnapshotAbortListenerAttached = false;
    const persistStoppedSnapshotFromRuntime = (source = "") => {
      if (stoppedSnapshotPersistencePromise) return stoppedSnapshotPersistencePromise;
      stoppedSnapshotPersistencePromise = saveStoppedModelMessageSnapshotCandidate({
        globalConfig: lifecycleRuntime?.globalConfig || {},
        candidate: lifecycleRuntime?.stoppedModelMessageSnapshotCandidate,
        eventListener: resolvedRuntimeEventListener,
        source,
      });
      return stoppedSnapshotPersistencePromise;
    };
    const attachStoppedSnapshotAbortListener = () => {
      if (stoppedSnapshotAbortListenerAttached || !abortSignal) return;
      if (!lifecycleRuntime || typeof lifecycleRuntime !== "object") return;
      stoppedSnapshotAbortListenerAttached = true;
      const onAbort = () => {
        if (isUserStopAbort(null, abortSignal)) {
          void persistStoppedSnapshotFromRuntime("runner_user_stop_signal");
        }
      };
      if (abortSignal.aborted) {
        onAbort();
        return;
      }
      if (typeof abortSignal.addEventListener === "function") {
        abortSignal.addEventListener("abort", onAbort, { once: true });
      }
    };
    resetAgentContextCompatFieldHitStats();
    const flushCompatFieldHitStats = () => {
      const stats = getAgentContextCompatFieldHitStats();
      const entries = Object.entries(stats);
      if (entries.length > 0) {
        emitEvent(resolvedRuntimeEventListener || eventListener, "agent_context_compat_field_hits", {
          sessionId: resolvedUsedSessionId,
          dialogProcessId: resolvedDialogProcessId,
          fields: stats,
        });
      }
      resetAgentContextCompatFieldHitStats();
    };
    try {
      const normalizedMessage = this.normalizeRunMessage(message);
      this.validateRunInput({ userId, sessionId, caller, parentSessionId });
      const normalizedRequestTurnScopeId = resolveRunTurnScopeId({
        caller,
        turnScopeId: turnScopeId || runConfig?.turnScopeId,
      });
      resolvedParentAsyncResultContainer = this.ensureParentAsyncResultContainer({
        parentAsyncResultContainer,
        caller,
        parentSessionId,
        parentDialogProcessId,
      });
      const {
        usedSessionId,
        dialogProcessId,
        sessionLoadState,
        userConfig,
        currentSessionModelAlias,
        executionStartIndex,
        runtimeEventListener,
      } = await this.initializeRunSessionRuntime({
        userId,
        sessionId,
        parentSessionId,
        caller,
        eventListener,
        dialogProcessId: requestedDialogProcessId,
        turnScopeId: normalizedRequestTurnScopeId,
        thinkingStartedAt: String(runConfig?.thinkingStartedAt || "").trim(),
        persistenceContext,
      });
      const requestRunConfig = {
        ...(runConfig && typeof runConfig === "object" && !Array.isArray(runConfig)
          ? runConfig
          : {}),
        ...(normalizedRequestTurnScopeId ? { turnScopeId: normalizedRequestTurnScopeId } : {}),
      };
      const scenarioResolvedRunConfig = this.resolveScenarioRunConfig(
        requestRunConfig,
        userConfig,
      );
      resolvedRunConfig =
        typeof this.prepareRunConfig === "function"
          ? this.prepareRunConfig({
              userId,
              runConfig: scenarioResolvedRunConfig,
              userConfig,
            })
          : scenarioResolvedRunConfig;
      const resolvedTurnScopeId = String(resolvedRunConfig?.turnScopeId || "").trim();
      const presentationMessageId = String(
        resolvedRunConfig?.presentationMessageId || `msg_${resolvedTurnScopeId}`,
      ).trim();
      const messageId = String(
        resolvedRunConfig?.messageId || `msg_event_${presentationMessageId}`,
      ).trim();
      resolvedRunConfig.presentationMessageId = presentationMessageId;
      resolvedRunConfig.messageId = messageId;
      const resumeFromStoppedSnapshot = resolvedRunConfig?.resumeFromStoppedSnapshot === true;
      const contextMode = sessionLoadState === "loaded" ? "existing_session" : "new_session";
      lifecycle = createAgentLifecycleMachine({
        eventListener: runtimeEventListener,
        now: () => this.now(),
        basePayload: {
          sessionId: usedSessionId,
          dialogProcessId,
          turnScopeId: resolvedTurnScopeId,
          resumeFromStoppedSnapshot,
          executionId: String(resolvedRunConfig?.executionId || "").trim(),
          executionKind: String(resolvedRunConfig?.executionKind || "agent").trim(),
          parentExecutionId: String(resolvedRunConfig?.parentExecutionId || "").trim(),
          rootExecutionId: String(resolvedRunConfig?.rootExecutionId || resolvedRunConfig?.executionId || "").trim(),
        },
      });
      lifecycle.transition(resolveInitialLifecycleState(resolvedRunConfig));
      if (
        !String(resolvedRunConfig?.runtimeModel || "").trim() &&
        !readSelectedModelValue(
          resolvedRunConfig?.config?.selectedModel ?? resolvedRunConfig?.selectedModel,
        ) &&
        String(currentSessionModelAlias || "").trim()
      ) {
        resolvedRunConfig.runtimeModel = String(currentSessionModelAlias || "").trim();
      }
      const botHookRuntime = {
        eventListener: runtimeEventListener,
        botHookManager:
          resolvedRunConfig?.botHookManager &&
          typeof resolvedRunConfig.botHookManager === "object"
            ? resolvedRunConfig.botHookManager
            : null,
        botHooks:
          resolvedRunConfig?.botHooks && typeof resolvedRunConfig.botHooks === "object"
            ? resolvedRunConfig.botHooks
            : null,
      };
      const botHookBase = withBotHookRuntimeMeta(
        {
          userId,
          sessionId: usedSessionId,
          parentSessionId,
          dialogProcessId,
          caller,
        },
        {
          runConfig: resolvedRunConfig,
        },
      );
      resolvedUsedSessionId = usedSessionId;
      resolvedDialogProcessId = dialogProcessId;
      resolvedRuntimeEventListener = runtimeEventListener;
      emitEvent(
        runtimeEventListener,
        "plugin_runtime_resolved",
        buildSessionRuntimePluginResolvedEvent(resolvedRunConfig),
      );
      await runBotRuntimeHook({
        runtime: botHookRuntime,
        point: BOT_HOOK_POINTS.BEFORE_SESSION_RUN,
        context: {
          ...botHookBase,
          message: normalizedMessage,
          isContinue: resumeFromStoppedSnapshot,
          sessionLoadState,
          resumeFromStoppedSnapshot,
        },
        eventListener: runtimeEventListener,
      });

      const buildContextPayload = {
        mode: contextMode,
        userId,
        sessionId: usedSessionId,
        caller,
        parentSessionId,
        userConfig,
        userMessageAttachments: attachments,
        systemMessages: Array.isArray(systemMessages) ? systemMessages : [],
        eventListener: runtimeEventListener,
        dialogProcessId,
        userInteractionBridge,
        runConfig: resolvedRunConfig,
        abortSignal,
        parentAsyncResultContainer: resolvedParentAsyncResultContainer,
        persistenceContext,
      };
      emitEvent(runtimeEventListener, "debug_resend_runner_received", {
        sessionId: usedSessionId,
        dialogProcessId,
        turnScopeId: resolvedTurnScopeId,
        requestThinkingStartedAt: String(requestRunConfig?.thinkingStartedAt || "").trim(),
        scenarioThinkingStartedAt: String(
          scenarioResolvedRunConfig?.thinkingStartedAt || "",
        ).trim(),
        resolvedThinkingStartedAt: String(resolvedRunConfig?.thinkingStartedAt || "").trim(),
        reuseExistingUserTurn: resolvedRunConfig?.reuseExistingUserTurn === true,
        attachments: summarizeDebugAttachments(attachments),
        userMessageAttachments: summarizeDebugAttachments(buildContextPayload.userMessageAttachments),
      });
      const preparedTurnInput = typeof this.prepareTurnInput === "function"
        ? await this.prepareTurnInput({ buildContextPayload })
        : { userMessageAttachments: attachments };
      const canonicalAttachments = Array.isArray(preparedTurnInput?.userMessageAttachments)
        ? preparedTurnInput.userMessageAttachments
        : [];
      buildContextPayload.userMessageAttachments = canonicalAttachments;
      if (preparedTurnInput?.contextBuilder) buildContextPayload.contextBuilder = preparedTurnInput.contextBuilder;
      if (resolvedRunConfig?.reuseExistingUserTurn === true) {
        await this.stampReusedUserTurnDialogProcessId?.({
          userId,
          sessionId: usedSessionId,
          parentSessionId,
          turnScopeId: resolvedTurnScopeId,
          dialogProcessId,
          attachments: canonicalAttachments,
          ...(persistenceContext ? { persistenceContext } : {}),
        });
      } else {
        const turnCommand = createTurnCommand({
          userId,
          sessionId: usedSessionId,
          parentSessionId,
          dialogProcessId,
          parentDialogProcessId,
          turnScopeId: resolvedTurnScopeId,
          message: normalizedMessage,
          attachments: canonicalAttachments,
          runConfig: resolvedRunConfig,
          caller,
        });
        const commitPayload = toCommitTurnPayload(turnCommand);
        const commitPayloadWithPersistence = { ...commitPayload, persistenceContext };
        const commitResult = typeof this.commitSessionTurn === "function"
          ? await this.commitSessionTurn(commitPayloadWithPersistence)
          : await this.appendSessionTurn({
              ...commitPayloadWithPersistence,
              role: MESSAGE_ROLE.USER,
              type: MESSAGE_TYPE.MESSAGE,
              frontendUserMessage: commitPayload.frontendUserMessage === true,
              messageOrigin: commitPayload.frontendUserMessage === true ? "user" : "internal",
              eventListener: runtimeEventListener,
            }).then(() => ({ attachments: canonicalAttachments }));
        canonicalAttachments.splice(0, canonicalAttachments.length, ...(commitResult?.attachments || []));
        emitEvent(runtimeEventListener, "turn_committed", {
          sessionId: commitResult?.sessionId || usedSessionId,
          sessionVersion: commitResult?.version ?? commitResult?.sessionVersion,
          dialogProcessId,
          turnScopeId: resolvedTurnScopeId,
        });
      }
      if (typeof this.prepareAgentTurnExecution !== "function") {
        throw new Error("prepareAgentTurnExecution is required");
      }
      const preparedAgentTurnExecution = await this.prepareAgentTurnExecution({
        buildContextPayload,
        abortSignal,
        persistenceContext,
      });
      const { agentContext, runtimeAgentContext, userMessageAttachments } =
        this._normalizePreparedAgentTurnExecution(preparedAgentTurnExecution);
      const dispatchRuntime = runtimeAgentContext?.execution?.controllers?.runtime;
      if (dispatchRuntime && typeof dispatchRuntime === "object") {
        lifecycleRuntime = dispatchRuntime;
        bindAssistantMessageEventStream(dispatchRuntime, { messageId, presentationMessageId });
        applyRuntimeUserMessageAttachments(dispatchRuntime, userMessageAttachments);
        bindLifecycleToRuntime(dispatchRuntime, lifecycle);
        attachStoppedSnapshotAbortListener();
        const pendingMessageEvents = [];
        const activityState = dispatchRuntime.systemRuntime && typeof dispatchRuntime.systemRuntime === "object"
          ? dispatchRuntime.systemRuntime
          : (dispatchRuntime.systemRuntime = {});
        activityState.activityTimeline = activityState.activityTimeline && typeof activityState.activityTimeline === "object"
          ? activityState.activityTimeline
          : { sequence: 0 };
        const reduceCurrentTurnActivity = (activityFact = {}) => {
          const eventId = String(activityFact.eventId || "").trim();
          if (!eventId) return null;
          const sequence = Number(activityFact.sequence) > 0
            ? Number(activityFact.sequence)
            : (activityState.activityTimeline.sequence += 1);
          activityState.activityTimeline.sequence = Math.max(
            Number(activityState.activityTimeline.sequence || 0),
            sequence,
          );
          return {
            ...activityFact,
            sequence,
            sequenceDomain: String(activityFact.sequenceDomain || "message-event").trim(),
            sequenceScopeId: String(
              activityFact.sequenceScopeId ||
                dispatchRuntime?.runConfig?.presentationMessageId ||
                dispatchRuntime?.systemRuntime?.turnScopeId ||
                resolvedTurnScopeId ||
                "turn",
            ).trim(),
            authority: String(activityFact.authority || "authoritative").trim(),
          };
        };
        dispatchRuntime.projectCurrentTurnMessageEvent = (envelope = {}) => {
          if (!envelope || typeof envelope !== "object") return null;
          const eventId = String(envelope.eventId || "").trim();
          if (!eventId) return null;
          if (!isToolMessageEvent(envelope) && !isActivityMessageEvent(envelope)) return envelope;
          const store = dispatchRuntime.currentTurnMessages;
          const messages = store?.toArray?.() || [];
          const existingAssistantIndex = [...messages]
            .map((item, index) => ({ item, index }))
            .reverse()
            .find(({ item }) => item?.role === "assistant");
          if (!existingAssistantIndex) {
            if (!pendingMessageEvents.some((item) => item.eventId === eventId)) {
              pendingMessageEvents.push(envelope);
            }
            return envelope;
          }
          const isToolEvent = isToolMessageEvent(envelope);
          const currentTimeline = isToolEvent
            ? existingAssistantIndex.item.toolTimeline
            : existingAssistantIndex.item.activityTimeline;
          const observed = isToolEvent
            ? (Array.isArray(currentTimeline) ? currentTimeline : []).some((item) =>
                String(item?.call?.eventId || "") === eventId || String(item?.resultEvent?.eventId || "") === eventId)
            : (Array.isArray(currentTimeline) ? currentTimeline : []).some((item) => String(item?.eventId || "") === eventId);
          if (observed) {
            return envelope;
          }
          const patch = isToolEvent
            ? { toolTimeline: reduceCanonicalToolTimeline(currentTimeline, envelope) }
            : { activityTimeline: [...(Array.isArray(currentTimeline) ? currentTimeline : []), reduceCurrentTurnActivity(envelope)] };
          store.updateWhere(
            patch,
            (_item, index) => index === existingAssistantIndex.index,
          );
          void dispatchRuntime.persistCurrentTurnMessages?.();
          return envelope;
        };
        dispatchRuntime.materializePendingCurrentTurnMessageEvents = ({
          activityTimeline = [],
          toolTimeline = [],
        } = {}) => {
          const facts = pendingMessageEvents.splice(0, pendingMessageEvents.length);
          return facts.reduce((projection, fact) => {
            if (isToolMessageEvent(fact)) {
              projection.toolTimeline = reduceCanonicalToolTimeline(projection.toolTimeline, fact);
            } else if (isActivityMessageEvent(fact)) {
              projection.activityTimeline.push(reduceCurrentTurnActivity(fact));
            }
            return projection;
          }, {
            activityTimeline: Array.isArray(activityTimeline) ? [...activityTimeline] : [],
            toolTimeline: Array.isArray(toolTimeline) ? [...toolTimeline] : [],
          });
        };
        let persistCurrentTurnMessagesTail = Promise.resolve();
        let currentTurnPersistenceBatchDepth = 0;
        let currentTurnPersistenceRequested = false;
        const persistedCurrentTurnMessageFingerprints = new Map();
        dispatchRuntime.timelineCheckpointPersistedMessageUids = [];
        const enqueueCurrentTurnMessagesPersistence = () => {
          const persist = async () => {
            const store = dispatchRuntime.currentTurnMessages;
            const messages = store?.toArray?.();
            if (!Array.isArray(messages) || !messages.length) return;
            const checkpointEntries = buildCurrentTurnCheckpointEntries(messages);
            const changedEntries = checkpointEntries.filter(({ key, fingerprint }) =>
              fingerprint === null || persistedCurrentTurnMessageFingerprints.get(key) !== fingerprint);
            const messagesToPersist = changedEntries.map(({ message }) => message);
            if (!messagesToPersist.length) {
              dispatchRuntime.timelineCheckpointPersistedMessageUids = messages
                .map((item = {}) => String(item.messageUid || "").trim())
                .filter(Boolean);
              return;
            }
            const persistedMessages = await this.appendAgentMessages?.({
              userId,
              sessionId: usedSessionId,
              parentSessionId,
              messages: messagesToPersist,
              dialogProcessId,
              parentDialogProcessId,
              turnScopeId: resolvedTurnScopeId,
              eventListener: runtimeEventListener,
              persistenceContext,
            });
            const activityMessages = messagesToPersist.filter((item = {}) =>
              String(item.messageUid || "").trim() &&
              Array.isArray(item.activityTimeline) &&
              item.activityTimeline.length > 0);
            let durableActivityMessages = [];
            if (activityMessages.length > 0 && (
              Array.isArray(persistedMessages) && persistedMessages.length > 0
              || typeof this.getSessionTurns === "function"
            )) {
              const durableMessages = Array.isArray(persistedMessages) && persistedMessages.length > 0
                ? persistedMessages
                : typeof this.getSessionTurns === "function"
                  ? await this.getSessionTurns({
                      userId,
                      sessionId: usedSessionId,
                      parentSessionId,
                      persistenceContext,
                    })
                  : [];
              const durableByUid = new Map((Array.isArray(durableMessages) ? durableMessages : [])
                .map((item = {}) => [String(item.messageUid || "").trim(), item])
                .filter(([messageUid]) => messageUid));
              durableActivityMessages = activityMessages.map((item = {}) => {
                const messageUid = String(item.messageUid || "").trim();
                const expectedEventIds = item.activityTimeline
                  .map((activity = {}) => String(activity.eventId || "").trim())
                  .filter(Boolean);
                const durable = durableByUid.get(messageUid);
                const durableEventIds = (Array.isArray(durable?.activityTimeline) ? durable.activityTimeline : [])
                  .map((activity = {}) => String(activity.eventId || "").trim())
                  .filter(Boolean);
                const missingEventIds = expectedEventIds.filter((eventId) => !durableEventIds.includes(eventId));
                return { messageUid, expectedEventIds, durableEventIds, missingEventIds };
              });
              const mismatch = durableActivityMessages.find((item) => item.missingEventIds.length > 0);
              if (mismatch) {
                emitEvent(runtimeEventListener, "timeline_checkpoint_durability_mismatch", {
                  sessionId: usedSessionId,
                  dialogProcessId,
                  turnScopeId: resolvedTurnScopeId,
                  messages: durableActivityMessages,
                });
                const error = new Error("canonical activity timeline was not durably persisted");
                error.code = "TIMELINE_CHECKPOINT_DURABILITY_MISMATCH";
                throw error;
              }
            }
            const currentKeys = new Set(checkpointEntries.map(({ key }) => key));
            for (const key of persistedCurrentTurnMessageFingerprints.keys()) {
              if (!currentKeys.has(key)) persistedCurrentTurnMessageFingerprints.delete(key);
            }
            for (const { key, fingerprint } of changedEntries) {
              if (fingerprint !== null) persistedCurrentTurnMessageFingerprints.set(key, fingerprint);
            }
            dispatchRuntime.timelineCheckpointPersistedMessageUids = messages
              .map((item = {}) => String(item.messageUid || "").trim())
              .filter(Boolean);
            emitEvent(runtimeEventListener, "timeline_checkpoint_verified", {
              sessionId: usedSessionId,
              dialogProcessId,
              turnScopeId: resolvedTurnScopeId,
              activityMessageCount: activityMessages.length,
              messages: durableActivityMessages,
            });
            emitEvent(runtimeEventListener, "timeline_checkpoint_persisted", {
              sessionId: usedSessionId,
              dialogProcessId,
              parentDialogProcessId,
              turnScopeId: resolvedTurnScopeId,
              messageCount: messages.length,
              persistedMessageCount: messagesToPersist.length,
              assistantCount: messages.filter((item = {}) => item.role === "assistant").length,
              toolCount: messages.filter((item = {}) => item.role === "tool").length,
              messages: messagesToPersist.map((item = {}) => ({
                messageUid: String(item.messageUid || "").trim(),
                messageId: String(item.messageId || item.id || "").trim(),
                presentationMessageId: String(item.presentationMessageId || "").trim(),
                role: String(item.role || "").trim(),
                type: String(item.type || "").trim(),
                chatPresentation: item.chatPresentation === true,
                contentLength: typeof item.content === "string" ? item.content.length : 0,
                activityTimelineCount: Array.isArray(item.activityTimeline) ? item.activityTimeline.length : 0,
                toolTimelineCount: Array.isArray(item.toolTimeline) ? item.toolTimeline.length : 0,
                toolCallIds: Array.isArray(item.toolTimeline)
                  ? item.toolTimeline
                      .map((tool = {}) => String(tool.toolCallId || "").trim())
                      .filter(Boolean)
                  : [],
                activityTimeline: Array.isArray(item.activityTimeline)
                  ? item.activityTimeline.slice(0, 64).map((activity = {}) => ({
                      eventId: String(activity.eventId || "").trim(),
                      activityKind: String(activity.activityKind || activity.type || "").trim(),
                      sequence: Number(activity.sequence || 0),
                      sequenceDomain: String(activity.sequenceDomain || "").trim(),
                      sequenceScopeId: String(activity.sequenceScopeId || "").trim(),
                      authority: String(activity.authority || "").trim(),
                    }))
                  : [],
              })),
            });
          };
          const next = persistCurrentTurnMessagesTail.then(persist, persist);
          persistCurrentTurnMessagesTail = next.catch(() => {});
          return next;
        };
        dispatchRuntime.persistCurrentTurnMessages = () => {
          if (currentTurnPersistenceBatchDepth > 0) {
            currentTurnPersistenceRequested = true;
            return Promise.resolve();
          }
          return enqueueCurrentTurnMessagesPersistence();
        };
        dispatchRuntime.withCurrentTurnPersistenceBatch = async (operation) => {
          currentTurnPersistenceBatchDepth += 1;
          try {
            return await operation();
          } finally {
            currentTurnPersistenceBatchDepth -= 1;
            if (currentTurnPersistenceBatchDepth === 0 && currentTurnPersistenceRequested) {
              currentTurnPersistenceRequested = false;
              await enqueueCurrentTurnMessagesPersistence();
            }
          }
        };
        dispatchRuntime.commitSummaryCheckpoint = (payload = {}) =>
          this.commitSummaryCheckpoint?.({
            runtime: dispatchRuntime,
            userId,
            sessionId: usedSessionId,
            parentSessionId,
            dialogProcessId,
            parentDialogProcessId,
            turnScopeId: resolvedTurnScopeId,
            eventListener: runtimeEventListener,
            persistenceContext,
            ...payload,
          });
      }
      emitEvent(runtimeEventListener, "debug_resend_runner_prepared", {
        sessionId: usedSessionId,
        dialogProcessId,
        turnScopeId: resolvedTurnScopeId,
        resolvedThinkingStartedAt: String(resolvedRunConfig?.thinkingStartedAt || "").trim(),
        reuseExistingUserTurn: resolvedRunConfig?.reuseExistingUserTurn === true,
        requestAttachments: summarizeDebugAttachments(attachments),
        userMessageAttachments: summarizeDebugAttachments(userMessageAttachments),
      });
      if (resolvedRunConfig?.reuseExistingUserTurn === true) {
        emitEvent(runtimeEventListener, "debug_resend_runner_reuse_before_stamp", {
          sessionId: usedSessionId,
          dialogProcessId,
          turnScopeId: resolvedTurnScopeId,
          attachments: summarizeDebugAttachments(userMessageAttachments),
        });
        emitEvent(runtimeEventListener, "debug_resend_runner_reuse_after_stamp", {
          sessionId: usedSessionId,
          dialogProcessId,
          turnScopeId: resolvedTurnScopeId,
          attachments: summarizeDebugAttachments(userMessageAttachments),
        });
      }
      const agentContextSummary = this._buildAgentContextSummary(runtimeAgentContext);
      const agentResult = await dispatchAgentTurn({
        agentRunner: this.agentRunner,
        errorLogger: this.errorLogger,
        lifecycle,
        dispatchRuntime,
        runtimeAgentContext,
        abortSignal,
        normalizedMessage,
        userMessageAttachments,
        resolvedRunConfig,
        runtimeEventListener,
        botHookRuntime,
        botHookBase,
        agentContextSummary,
        usedSessionId,
        dialogProcessId,
        resolvedTurnScopeId,
        syncLifecycleRuntimeState,
      });
      const finalizedResult = await finalizeAgentTurn({
        resolvedRunConfig, runtimeEventListener, usedSessionId, dialogProcessId,
        resolvedTurnScopeId, dispatchRuntime, getSessionTurns: this.getSessionTurns,
        getTurnSummaryCheckpointState: this.getTurnSummaryCheckpointState,
        finalizeRunSession: this.finalizeRunSession, userId, parentSessionId,
        parentDialogProcessId, caller, agentResult, executionStartIndex, userConfig,
        resolvedParentAsyncResultContainer, lifecycle, persistenceContext,
      });
      await runBotRuntimeHook({
        runtime: botHookRuntime,
        point: BOT_HOOK_POINTS.AFTER_SESSION_RUN,
        context: {
          ...botHookBase,
          message: normalizedMessage,
          isContinue: resumeFromStoppedSnapshot,
          sessionLoadState,
          resumeFromStoppedSnapshot,
          result: finalizedResult,
        },
        eventListener: runtimeEventListener,
      });
      flushCompatFieldHitStats();
      return finalizedResult;
    } catch (error) {
      if (isAbortError(error)) {
        if (isUserStopAbort(error, abortSignal)) {
          // A user stop is still a completed persistence boundary for the
          // work already committed to the current turn.  Keep the same
          // canonical messages used by live checkpoints and replay.
          await lifecycleRuntime?.persistCurrentTurnMessages?.();
          const stoppedSnapshotPersistence = await persistStoppedSnapshotFromRuntime("runner_user_stop_catch");
          await lifecycle?.userStop?.({
            reason: tSystem("ws.dialogStoppedByUser"),
            stoppedSnapshotPersistence,
          });
          // Lifecycle terminal persistence may write a stale session object.
          // Re-commit the canonical turn store after that boundary so the
          // durable turn artifact contains the same activity timeline as the
          // last running checkpoint.
          await lifecycleRuntime?.persistCurrentTurnMessages?.();
        } else {
          lifecycle?.interrupt?.({
            reason: error?.message || String(error),
            stopType: resolveAbortStopType(error, abortSignal),
            stoppedSnapshotPersistence: {
              status: "skipped",
              reason: "non_user_abort",
              source: "runner_abort_catch",
              messageCount: 0,
              systemCount: 0,
              historyCount: 0,
              incrementalCount: 0,
            },
          });
        }
      } else {
        lifecycle?.fail?.({ error });
      }
      syncLifecycleRuntimeState(lifecycleRuntime, lifecycle);
      if (error && typeof error === "object" && lifecycle?.snapshot) {
        error.lifecycle = lifecycle.snapshot;
      }
      await runBotRuntimeHook({
        runtime: {
          eventListener: resolvedRuntimeEventListener,
          botHookManager:
            resolvedRunConfig?.botHookManager &&
            typeof resolvedRunConfig.botHookManager === "object"
              ? resolvedRunConfig.botHookManager
              : null,
          botHooks:
            resolvedRunConfig?.botHooks && typeof resolvedRunConfig.botHooks === "object"
              ? resolvedRunConfig.botHooks
              : null,
        },
        point: BOT_HOOK_POINTS.SESSION_RUN_ERROR,
        context: withBotHookRuntimeMeta(
          {
            userId,
            sessionId: resolvedUsedSessionId,
            parentSessionId,
            dialogProcessId: resolvedDialogProcessId,
            caller,
          },
          {
            message,
            runConfig: resolvedRunConfig,
            error,
          },
        ),
        eventListener: resolvedRuntimeEventListener,
      });
      this.upsertParentAsyncTask({
        parentAsyncResultContainer: resolvedParentAsyncResultContainer,
        sessionId,
        parentSessionId,
        patch: {
          status: isAbortError(error) && isUserStopAbort(error, abortSignal)
            ? SESSION_ASYNC_STATUS.USER_STOPPED
            : SESSION_ASYNC_STATUS.FAILED,
          endedAt: this.now(),
          error: isAbortError(error) && isUserStopAbort(error, abortSignal)
            ? tSystem("ws.dialogStoppedByUser")
            : error?.message || String(error),
          result: null,
        },
      });
      if (isAbortError(error)) {
        throw error;
      }
      await this.errorLogger.log({
        userId,
        sessionId,
        parentSessionId,
        source: BOT_MANAGE_LOG_SOURCE.RUN_SESSION,
        event: BOT_MANAGE_LOG_EVENT.RUN_SESSION_FAILED,
        error,
      });
      flushCompatFieldHitStats();
      throw error;
    }
  }
}
