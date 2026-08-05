/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { randomUUID } from "node:crypto";
import { emitEvent } from "../../events/index.js";
import { getRuntimeFromAgentContext } from "../../context/agent-context-accessor.js";
import { CALLER_ROLE } from "../config/constants.js";
import { TURN_EVENT, TURN_PHASE } from "@noobot/session-protocol";
import {
  normalizeTrimmedStringList,
} from "./session-execution-engine-utils.js";

async function transferCanonicalAttachmentsToSubSession({
  attachmentService = null,
  userId = "",
  parentSessionId = "",
  subSessionId = "",
  attachments = [],
  attachmentPolicy = {},
} = {}) {
  const source = Array.isArray(attachments) ? attachments : [];
  if (!source.length) return [];
  const output = [];
  for (const attachment of source) {
    const attachmentId = String(attachment?.attachmentId || "").trim();
    const path = String(attachment?.path || "").trim();
    if (!attachmentId || !path) {
      output.push(attachment);
      continue;
    }
    const attachmentSessionId = String(attachment?.sessionId || "").trim();
    if (attachmentSessionId === subSessionId) {
      output.push(attachment);
      continue;
    }
    if (attachmentSessionId !== parentSessionId) {
      throw new Error("detached sub-session attachment must belong to its parent session");
    }
    if (
      !attachmentService ||
      typeof attachmentService.getAttachmentById !== "function" ||
      typeof attachmentService.readAttachmentContent !== "function" ||
      typeof attachmentService.ingest !== "function"
    ) {
      throw new Error("detached sub-session canonical attachment transfer requires AttachmentService");
    }
    const attachmentSource = String(attachment?.attachmentSource || "user").trim() || "user";
    const parentRecord = await attachmentService.getAttachmentById({
      userId,
      attachmentId,
      sessionId: parentSessionId,
      attachmentSource,
    });
    if (!parentRecord) {
      throw new Error("detached sub-session source attachment does not exist in its parent session");
    }
    const sourceContent = await attachmentService.readAttachmentContent({ userId, attachmentId });
    if (!sourceContent?.content) {
      throw new Error("detached sub-session source attachment content is unavailable");
    }
    const [transferred] = await attachmentService.ingest({
      userId,
      sessionId: subSessionId,
      attachmentSource: "user",
      attachmentPolicy: attachmentPolicy && typeof attachmentPolicy === "object" ? attachmentPolicy : {},
      attachments: [{
        clientAttachmentId: String(attachment?.clientAttachmentId || `session-transfer:${attachmentId}`).trim(),
        name: String(parentRecord?.name || attachment?.name || "attachment").trim(),
        mimeType: String(parentRecord?.mimeType || attachment?.mimeType || "application/octet-stream").trim(),
        contentBase64: sourceContent.content.toString("base64"),
        ...(typeof attachment?.isSandbox === "boolean" ? { isSandbox: attachment.isSandbox } : {}),
      }],
    });
    if (!transferred || String(transferred?.sessionId || "").trim() !== subSessionId) {
      throw new Error("detached sub-session attachment transfer did not create child ownership");
    }
    output.push(transferred);
  }
  return output;
}

export function createDetachedSubSessionRunner({
  workspaceService = null,
  configService = null,
  sessionRunner = null,
  session = null,
  attachmentService = null,
  pluginRuntime = {},
  mergeRunConfigWithPluginStrategy = null,
  prepareRunConfig = null,
  now = () => new Date().toISOString(),
} = {}) {
  return async ({
    parentExecutionScope = null,
    parentContext = {},
    message = "",
    attachments = [],
    runConfigPatch = {},
    systemMessages = [],
    strategy = {},
    metadata = {},
    eventListener = null,
    abortSignal = null,
  } = {}) => {
    if (!sessionRunner || typeof sessionRunner.runSession !== "function") {
      throw new Error("detached sub-session runner requires the main SessionExecutionRunner");
    }
    if (!session || typeof session.createScopedPersistenceContext !== "function") {
      throw new Error("detached sub-session runner requires scoped persistence context support");
    }
    const sourceContext = parentContext && typeof parentContext === "object" ? parentContext : {};
    let inheritedRuntime;
    try {
      inheritedRuntime = getRuntimeFromAgentContext(parentExecutionScope);
    } catch (error) {
      emitEvent(eventListener, "detached_sub_session_scope_rejected", {
        userId: String(strategy?.userId || parentContext?.userId || "").trim(),
        parentSessionId: String(strategy?.parentSessionId || parentContext?.sessionId || "").trim(),
        scopeId: String(metadata?.scope || "detached_sub_session").trim(),
        reason: "bindings.runtime_missing",
        error: error?.message || String(error),
      });
      throw error;
    }
    const inheritedAbortSignal = abortSignal || sourceContext?.abortSignal || inheritedRuntime?.abortSignal || null;
    const inheritedUserInteractionBridge = sourceContext?.userInteractionBridge || inheritedRuntime?.userInteractionBridge || null;
    const throwIfSubSessionAborted = createAbortGuard(inheritedAbortSignal);
    throwIfSubSessionAborted();

    const userId = String(strategy?.userId || sourceContext?.userId || "").trim();
    const parentSessionId = String(strategy?.parentSessionId || sourceContext?.sessionId || "").trim();
    const parentDialogProcessId = String(strategy?.parentDialogProcessId || sourceContext?.dialogProcessId || "").trim();
    if (!userId || !parentSessionId) {
      throw new Error("sub-session runner requires userId and parentSessionId");
    }

    const subSessionId = String(strategy?.sessionId || "").trim();
    const subDialogProcessId = String(strategy?.dialogProcessId || "").trim();
    const turnScopeId = String(strategy?.turnScopeId || "").trim();
    const executionId = String(strategy?.executionId || "").trim();
    const relativeDir = String(strategy?.relativeDir || "").trim();
    const allowedRoot = String(strategy?.allowedRoot || "").trim();
    if (
      !subSessionId ||
      !subDialogProcessId ||
      !turnScopeId ||
      !executionId ||
      !relativeDir ||
      !allowedRoot
    ) {
      throw new TypeError(
        "detached sub-session strategy requires sessionId, dialogProcessId, turnScopeId, executionId, relativeDir and allowedRoot",
      );
    }
    const scopedEventListener = createScopedSubSessionEventListener(eventListener, {
      userId,
      sessionId: subSessionId,
      parentSessionId,
      dialogProcessId: subDialogProcessId || subSessionId,
      turnScopeId,
    });

    const inheritedRunConfig = clearParentTurnTransactionIdentity({
      ...(sourceContext?.runConfig && typeof sourceContext.runConfig === "object"
        ? sourceContext.runConfig
        : inheritedRuntime?.runConfig && typeof inheritedRuntime.runConfig === "object"
          ? inheritedRuntime.runConfig
          : {}),
    });
    const mergedRunConfig = mergeRunConfigWithPluginStrategy({
      baseRunConfig: inheritedRunConfig,
      runConfigPatch,
      disabledPlugins: strategy?.disabledPlugins || [],
    });
    mergedRunConfig.executionId = executionId;
    mergedRunConfig.executionKind = "agent";
    mergedRunConfig.parentExecutionId = String(strategy?.parentExecutionId || metadata?.parentExecutionId || "").trim();
    mergedRunConfig.rootExecutionId = String(
      strategy?.rootExecutionId || metadata?.rootExecutionId || mergedRunConfig.executionId,
    ).trim();
    // A detached Turn owns a distinct canonical message domain.  Neither the
    // parent context, the node patch nor config preparation may choose this
    // identity because all three can contain the parent workflow message.
    const childPresentationMessageId = `msg_${randomUUID()}`;
    const childMessageId = `msg_event_${childPresentationMessageId}`;
    mergedRunConfig.presentationMessageId = childPresentationMessageId;
    mergedRunConfig.messageId = childMessageId;
    delete mergedRunConfig.assistantMessageId;
    if (!String(mergedRunConfig.thinkingStartedAt || "").trim()) {
      mergedRunConfig.thinkingStartedAt = String(now()).trim();
    }
    delete mergedRunConfig.hookManager;
    delete mergedRunConfig.hooks;
    delete mergedRunConfig.botHookManager;
    delete mergedRunConfig.botHooks;

    const subSessionUserConfig = await loadSubSessionUserConfig({ workspaceService, configService, userId });
    const effectiveRunConfig = prepareRunConfig({ userId, runConfig: mergedRunConfig, userConfig: subSessionUserConfig });
    if (!effectiveRunConfig || typeof effectiveRunConfig !== "object" || Array.isArray(effectiveRunConfig)) {
      throw new Error("detached sub-session prepareRunConfig must return a run config object");
    }
    effectiveRunConfig.presentationMessageId = childPresentationMessageId;
    effectiveRunConfig.messageId = childMessageId;
    delete effectiveRunConfig.assistantMessageId;
    const subSessionAttachments = await transferCanonicalAttachmentsToSubSession({
      attachmentService,
      userId,
      parentSessionId,
      subSessionId,
      attachments,
      attachmentPolicy: effectiveRunConfig?.attachments,
    });
    emitEvent(eventListener, "detached_sub_session_message_identity_bound", {
      userId,
      sessionId: subSessionId,
      parentSessionId,
      dialogProcessId: subDialogProcessId,
      turnScopeId,
      workflowRunId: String(effectiveRunConfig.workflowRunId || "").trim(),
      nodeExecutionId: String(
        effectiveRunConfig.workflowNodeExecutionId || effectiveRunConfig.nodeExecutionId || "",
      ).trim(),
      messageId: childMessageId,
      presentationMessageId: childPresentationMessageId,
    });

    const runtimePluginState = buildRuntimePluginState({
      effectiveRunConfig,
      disabledPlugins: strategy?.disabledPlugins,
      pluginRuntime,
    });
    emitEvent(eventListener, "plugin_runtime_resolved", runtimePluginState);

    const lifecycle = typeof session.getSessionLifecycle === "function"
      ? await session.getSessionLifecycle({ userId, sessionId: subSessionId })
      : null;
    const persistenceContext = session.createScopedPersistenceContext({
      userId,
      sessionId: subSessionId,
      parentSessionId,
      scopeId: mergedRunConfig.executionId,
      relativeDir,
      allowedRoot,
      ...(Number.isInteger(Number(lifecycle?.generation)) && Number(lifecycle.generation) > 0
        ? { sessionGeneration: Number(lifecycle.generation) }
        : {}),
      metadataContributor: () => ({
        userId,
        sessionId: subSessionId,
        parentSessionId,
        parentDialogProcessId,
        dialogProcessId: subDialogProcessId || subSessionId,
        ...(metadata && typeof metadata === "object" ? metadata : {}),
        runtimePluginState,
      }),
    });

    const persistenceScope = Object.freeze({
      scopeId: mergedRunConfig.executionId,
      parentSessionId,
      relativeDir,
      allowedRoot,
    });

    const lifecycleIdentity = {
      userId,
      sessionId: subSessionId,
      parentSessionId,
      persistenceContext,
      persistenceScope,
      turnScopeId,
      dialogProcessId: subDialogProcessId || subSessionId,
      messageId: childMessageId,
      presentationMessageId: childPresentationMessageId,
      executionId: mergedRunConfig.executionId,
      executionKind: "agent",
      parentExecutionId: mergedRunConfig.parentExecutionId,
      rootExecutionId: mergedRunConfig.rootExecutionId,
      origin: metadata?.origin || {},
      stage: String(metadata?.scope || "detached_sub_session").trim(),
    };
    const lifecycleCommandId = String(
      strategy?.commandId || runConfigPatch?.commandId || turnScopeId || subSessionId,
    ).trim();
    const commitLifecycle = async (event = {}) => {
      if (typeof session.applyTurnLifecycleEvent !== "function") {
        throw new Error("detached sub-session requires authoritative Turn lifecycle support");
      }
      const committed = await session.applyTurnLifecycleEvent({
        ...lifecycleIdentity,
        ...event,
      });
      if (!committed?.applied && !committed?.deduplicated) {
        throw new Error(committed?.reason || "detached sub-session lifecycle commit failed");
      }
      if (committed?.envelope) {
        await scopedEventListener?.onEvent?.({
          event: "turn_lifecycle_committed",
          data: {
            envelope: committed.envelope,
            persistenceScope,
          },
        });
      }
      return committed;
    };

    await commitLifecycle({
      commandId: `${lifecycleCommandId}:accepted`,
      eventType: TURN_EVENT.ACTION_ACCEPTED,
      phase: TURN_PHASE.ACTION,
      action: "send",
      executionState: "accepted",
      startedAt: effectiveRunConfig.thinkingStartedAt,
      createSessionIfAbsent: true,
      expectedRevision: 0,
    });
    await commitLifecycle({
      commandId: `${lifecycleCommandId}:processing-started`,
      eventType: TURN_EVENT.PROCESSING_STARTED,
      phase: TURN_PHASE.PROCESSING,
      executionState: "sending",
    });

    let result;
    try {
      result = await sessionRunner.runSession({
        userId,
        sessionId: subSessionId,
        parentSessionId,
        parentDialogProcessId,
        dialogProcessId: subDialogProcessId,
        caller: CALLER_ROLE.BOT,
        message,
        attachments: subSessionAttachments,
        systemMessages: Array.isArray(systemMessages) ? systemMessages : [],
        eventListener: scopedEventListener,
        abortSignal: inheritedAbortSignal,
        userInteractionBridge: inheritedUserInteractionBridge,
        runConfig: effectiveRunConfig,
        turnScopeId,
        parentAsyncResultContainer: null,
        persistenceContext,
      });
      const returnedDialogProcessId = String(result?.dialogProcessId || "").trim();
      if (returnedDialogProcessId && returnedDialogProcessId !== subDialogProcessId) {
        const identityError = new Error(
          "detached sub-session returned a dialogProcessId different from its authoritative turn identity",
        );
        identityError.code = "DETACHED_DIALOG_IDENTITY_MISMATCH";
        emitEvent(eventListener, "detached_sub_session_identity_mismatch", {
          userId,
          sessionId: subSessionId,
          parentSessionId,
          turnScopeId,
          executionId: mergedRunConfig.executionId,
          authoritativeDialogProcessId: subDialogProcessId,
          returnedDialogProcessId,
          code: identityError.code,
        });
        throw identityError;
      }
    } catch (error) {
      let terminalLifecycle = null;
      const stopped = inheritedAbortSignal?.aborted || error?.name === "AbortError";
      if (stopped) {
        await commitLifecycle({
          commandId: `${lifecycleCommandId}:stop-accepted`,
          eventType: TURN_EVENT.STOP_ACCEPTED,
          phase: TURN_PHASE.ACTION,
          action: "stop",
        });
        await commitLifecycle({
          commandId: `${lifecycleCommandId}:stop-processing-completed`,
          eventType: TURN_EVENT.STOP_PROCESSING_COMPLETED,
          phase: TURN_PHASE.STOP,
        });
        const completionCommitId = `${lifecycleCommandId}:stop-completed`;
        terminalLifecycle = await commitLifecycle({
          commandId: completionCommitId,
          eventType: TURN_EVENT.STOP_COMPLETED,
          phase: TURN_PHASE.STOP,
          executionState: "user_stopped",
          completionCommitId,
          terminalStatus: {
            command: "user_stopped",
            description: "子 Agent 已停止",
          },
          finishedAt: String(now()).trim(),
        });
      } else {
        terminalLifecycle = await commitLifecycle({
          commandId: `${lifecycleCommandId}:failed`,
          eventType: TURN_EVENT.FAILED,
          phase: TURN_PHASE.PROCESSING,
          failure: {
            phase: TURN_PHASE.PROCESSING,
            code: String(error?.code || "detached_sub_session_failed").trim(),
            message: String(error?.message || "detached sub-session failed"),
            retryable: false,
          },
        });
      }
      if (error && typeof error === "object") {
        error.lifecycle = createDetachedTerminalReceipt({
          lifecycle: terminalLifecycle?.turn || error.lifecycle,
          executionId: mergedRunConfig.executionId,
          failed: !stopped,
        });
      }
      emitEvent(eventListener, stopped
        ? "detached_sub_session_stop_committed"
        : "detached_sub_session_failure_committed", {
        userId,
        sessionId: subSessionId,
        parentSessionId,
        dialogProcessId: subDialogProcessId,
        turnScopeId,
        executionId: mergedRunConfig.executionId,
        ...(stopped
          ? { reason: "user_stop" }
          : { errorCode: String(error?.code || "detached_sub_session_failed").trim() }),
        state: String(terminalLifecycle?.turn?.state || "").trim(),
        revision: Number(terminalLifecycle?.turn?.revision || 0),
        sequence: Number(terminalLifecycle?.turn?.sequence || 0),
      });
      throw error;
    }

    await commitLifecycle({
      commandId: `${lifecycleCommandId}:processing-completed`,
      eventType: TURN_EVENT.PROCESSING_COMPLETED,
      phase: TURN_PHASE.COMPLETION,
    });
    const completionCommitId = `${lifecycleCommandId}:completed`;
    const terminalLifecycle = await commitLifecycle({
      commandId: completionCommitId,
      eventType: TURN_EVENT.COMPLETED,
      phase: TURN_PHASE.COMPLETION,
      executionState: "completed",
      completionCommitId,
      terminalStatus: {
        command: "completed",
        description: "子 Agent 已正常完成",
      },
      finishedAt: String(now()).trim(),
    });

    const dialogProcessId = String(result?.dialogProcessId || subDialogProcessId || subSessionId).trim();
    return {
      userId,
      sessionId: subSessionId,
      parentSessionId,
      dialogProcessId,
      persisted: result?.session || null,
      lifecycle: createDetachedTerminalReceipt({
        lifecycle: terminalLifecycle?.turn || result?.lifecycle,
        executionId: mergedRunConfig.executionId,
      }),
      result: {
        sessionId: subSessionId,
        parentSessionId,
        parentDialogProcessId,
        caller: CALLER_ROLE.BOT,
        answer: String(result?.output || result?.answer || "").trim(),
        traces: Array.isArray(result?.traces) ? result.traces : [],
        messages: Array.isArray(result?.turnMessages) ? result.turnMessages : [],
        turnTasks: Array.isArray(result?.turnTasks) ? result.turnTasks : [],
        executionLogs: [],
        dialogProcessId,
      },
    };
  };
}

function clearParentTurnTransactionIdentity(runConfig = {}) {
  delete runConfig.resumeFromStoppedSnapshot;
  delete runConfig.resumeDialogProcessId;
  delete runConfig.resumeTurnScopeId;
  delete runConfig.expectedAggregateVersion;
  delete runConfig.commandId;
  delete runConfig.reuseExistingUserTurn;
  delete runConfig.thinkingStartedAt;
  delete runConfig.messageId;
  delete runConfig.presentationMessageId;
  delete runConfig.assistantMessageId;
  return runConfig;
}

export function createDetachedTerminalReceipt({ lifecycle = null, executionId = "", failed = false } = {}) {
  if (!lifecycle || typeof lifecycle !== "object" || Array.isArray(lifecycle)) return null;
  const sourceState = String(lifecycle?.state || lifecycle?.branchState || "").trim().toLowerCase();
  const state = sourceState === "completed"
    ? "completed"
    : sourceState === "user_stopped"
      ? "stop_completed"
      : failed || ["failed", "interrupted"].includes(sourceState)
        ? "processing_failed"
        : sourceState;
  return {
    ...lifecycle,
    executionId: String(lifecycle?.executionId || executionId || "").trim(),
    executionKind: "agent",
    state,
    revision: Number(lifecycle?.revision || 0),
    sequence: Number(lifecycle?.sequence || 0),
    failure: failed
      ? {
          code: String(lifecycle?.code || lifecycle?.failure?.code || "CHILD_EXECUTION_FAILED").trim(),
          message: String(lifecycle?.error || lifecycle?.failure?.message || "child execution failed").trim(),
        }
      : lifecycle?.failure || null,
  };
}

export function createScopedSubSessionEventListener(eventListener = null, identity = {}) {
  const target = resolveObjectEventListener(eventListener);
  if (!target) return null;
  if (typeof target.forwardEvent !== "function") {
    throw new TypeError("detached sub-session requires an execution event listener forwardEvent port");
  }
  return {
    onEvent(event = {}) {
      const source = event && typeof event === "object" ? event : {};
      const data = source.data && typeof source.data === "object" ? source.data : {};
      return target.forwardEvent({
        ...source,
        data: {
          ...data,
          userId: String(data.userId || identity.userId || "").trim(),
          sessionId: String(data.sessionId || identity.sessionId || "").trim(),
          parentSessionId: String(data.parentSessionId || identity.parentSessionId || "").trim(),
          dialogProcessId: String(data.dialogProcessId || identity.dialogProcessId || "").trim(),
          turnScopeId: String(data.turnScopeId || identity.turnScopeId || "").trim(),
        },
      });
    },
  };
}

function createAbortGuard(abortSignal = null) {
  return () => {
    if (!abortSignal?.aborted) return;
    const error = new Error("bot plugin sub-session aborted");
    error.name = "AbortError";
    error.code = "ABORT_ERR";
    throw error;
  };
}

async function loadSubSessionUserConfig({ workspaceService = null, configService = null, userId = "" } = {}) {
  try {
    const workspacePath = workspaceService.getWorkspacePath(userId);
    return await configService.loadUserConfig(workspacePath);
  } catch {
    return {};
  }
}

function buildRuntimePluginState({ effectiveRunConfig = {}, disabledPlugins = [] } = {}) {
  const selectedPlugins = normalizeTrimmedStringList(effectiveRunConfig?.selectedPlugins);
  const plugins = effectiveRunConfig?.plugins && typeof effectiveRunConfig.plugins === "object"
    ? effectiveRunConfig.plugins
    : {};
  return {
    selectedPlugins,
    plugins: Object.fromEntries(selectedPlugins.map((pluginId) => [pluginId, {
      enabled: plugins?.[pluginId]?.enabled === true,
      mode: String(plugins?.[pluginId]?.mode || "").trim().toLowerCase(),
    }])),
    hookManagersReady: Boolean(effectiveRunConfig?.hookManager && effectiveRunConfig?.botHookManager),
    disabledPlugins: normalizeTrimmedStringList(disabledPlugins),
    scope: "detached_sub_session",
  };
}

function resolveObjectEventListener(eventListener = null) {
  return eventListener && typeof eventListener === "object" && typeof eventListener.onEvent === "function"
    ? eventListener
    : null;
}
