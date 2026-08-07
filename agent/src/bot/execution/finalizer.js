/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { emitEvent } from "../../events/index.js";
import {
  CALLER_ROLE,
  SESSION_ASYNC_STATUS,
} from "../config/constants.js";
import {
  buildTransferPayloadFromAttachmentMetas,
  filterSemanticTransferAttachmentMetas,
} from "../../artifacts/meta-ops.js";
import { getTransferAttachmentMetas } from "../../transfer/storage/consumer.js";
import {
  compactAttachmentRef,
  compactTransferEnvelopes,
  dedupeAttachmentRefs,
} from "../../session/transfer-attachment-refs.js";
import { normalizeParentSessionId } from "../../context/parent-session-id-resolver.js";
import { summarizeExecutionLogs } from "../../observability/execution-log/execution-log-summary.js";
import {
  canonicalMessageId,
  emitContextIdentityDebug,
} from "../../observability/context-identity-debug.js";
const HIDDEN_INTERMEDIATE_GENERATION_SOURCES = new Set([
  "doc_to_data_tool",
  "media_to_data_tool",
  "tool_result_overflow",
]);

function shouldPromoteAttachmentToAssistant(attachmentItem = {}) {
  if (!attachmentItem || typeof attachmentItem !== "object" || Array.isArray(attachmentItem)) {
    return false;
  }
  const generationSource = String(attachmentItem?.generationSource || "").trim();
  if (HIDDEN_INTERMEDIATE_GENERATION_SOURCES.has(generationSource)) return false;
  const attachmentSource = String(attachmentItem?.attachmentSource || "").trim();
  return (
    attachmentItem?.generatedByModel === true ||
    attachmentSource === "model" ||
    attachmentSource === "model_generated" ||
    Boolean(generationSource)
  );
}

function shouldPromoteSemanticTransferAttachmentToAssistant(attachmentItem = {}) {
  return (
    filterSemanticTransferAttachmentMetas([attachmentItem]).length > 0 &&
    shouldPromoteAttachmentToAssistant(attachmentItem)
  );
}

function isPlainObject(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function summarizedMessageIds(messages = []) {
  return (Array.isArray(messages) ? messages : [])
    .filter((message = {}) => message?.summarized === true)
    .map((message = {}) => canonicalMessageId(message))
    .filter(Boolean);
}

function resolveTransferEnvelopesFromMessage(messageItem = {}) {
  return Array.isArray(messageItem?.transferEnvelopes)
    ? messageItem.transferEnvelopes.filter(isPlainObject)
    : [];
}

function resolveAttachmentsFromMessage(messageItem = {}) {
  if (Array.isArray(messageItem?.attachments)) return messageItem.attachments;
  return [];
}

function dedupeTransferEnvelopes(envelopes = []) {
  const list = compactTransferEnvelopes(envelopes);
  if (!list.length) return [];
  const seen = new Set();
  const output = [];
  for (const envelope of list) {
    if (!isPlainObject(envelope)) continue;
    const key =
      String(
        envelope?.files?.[0]?.attachmentMeta?.attachmentId ||
        envelope?.files?.[0]?.attachmentId ||
        envelope?.files?.[0]?.id ||
        envelope?.files?.[0]?.filePath ||
        envelope?.files?.[0]?.path ||
        "",
      ).trim() || JSON.stringify(envelope);
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(envelope);
  }
  return output;
}

function dedupeAttachments(attachments = []) {
  const list = dedupeAttachmentRefs(
    (Array.isArray(attachments) ? attachments : [])
      .map((attachment) => compactAttachmentRef(attachment))
      .filter(Boolean),
  );
  if (!list.length) return [];
  return list;
}

function shouldPromoteTransferEnvelope(envelope = {}) {
  if (!isPlainObject(envelope)) return false;
  const metas = getTransferAttachmentMetas(envelope);
  if (!metas.length) return true;
  return metas.some((item = {}) => shouldPromoteSemanticTransferAttachmentToAssistant(item));
}

function promoteGeneratedTransfersToFinalAssistant(messages = []) {
  const sourceMessages = Array.isArray(messages) ? messages : [];
  if (!sourceMessages.length) return sourceMessages;
  const generatedTransferEnvelopes = dedupeTransferEnvelopes(
    sourceMessages.flatMap((messageItem = {}) =>
      resolveTransferEnvelopesFromMessage(messageItem).filter(shouldPromoteTransferEnvelope),
    ),
  );
  const generatedAttachmentMetas = sourceMessages.flatMap((messageItem = {}) =>
    resolveTransferEnvelopesFromMessage(messageItem).length
      ? []
      : resolveAttachmentsFromMessage(messageItem)
          .filter(shouldPromoteSemanticTransferAttachmentToAssistant),
  );
  const generatedOrdinaryAttachments = dedupeAttachments(
    sourceMessages.flatMap((messageItem = {}) =>
      resolveTransferEnvelopesFromMessage(messageItem).length
        ? []
        : resolveAttachmentsFromMessage(messageItem)
            .filter((attachmentItem = {}) =>
              shouldPromoteAttachmentToAssistant(attachmentItem) &&
              !shouldPromoteSemanticTransferAttachmentToAssistant(attachmentItem),
            ),
    ),
  );
  const generatedAttachmentTransferPayload = buildTransferPayloadFromAttachmentMetas(generatedAttachmentMetas);
  const generatedAttachmentTransferEnvelopes = Array.isArray(generatedAttachmentTransferPayload?.transferEnvelopes)
    ? generatedAttachmentTransferPayload.transferEnvelopes
    : [];
  if (
    !generatedTransferEnvelopes.length &&
    !generatedAttachmentTransferEnvelopes.length &&
    !generatedOrdinaryAttachments.length
  ) return sourceMessages;

  const finalAssistantIndex = (() => {
    for (let index = sourceMessages.length - 1; index >= 0; index -= 1) {
      const item = sourceMessages[index] || {};
      if (
        String(item?.role || "") === "assistant" &&
        String(item?.type || "message") !== "tool_call"
      ) {
        return index;
      }
    }
    return -1;
  })();
  if (finalAssistantIndex < 0) return sourceMessages;

  const outputMessages = [...sourceMessages];
  const finalAssistant = outputMessages[finalAssistantIndex] || {};
  const mergedTransferEnvelopes = dedupeTransferEnvelopes([
    ...resolveTransferEnvelopesFromMessage(finalAssistant),
    ...generatedTransferEnvelopes,
    ...generatedAttachmentTransferEnvelopes,
  ]);
  const mergedAttachments = dedupeAttachments([
    ...resolveAttachmentsFromMessage(finalAssistant),
    ...generatedOrdinaryAttachments,
  ]);
  const nextFinalAssistant = {
    ...finalAssistant,
    ...(mergedTransferEnvelopes.length ? { transferEnvelopes: mergedTransferEnvelopes } : {}),
    ...(mergedAttachments.length ? { attachments: mergedAttachments } : {}),
  };
  outputMessages[finalAssistantIndex] = nextFinalAssistant;
  return outputMessages;
}

export class SessionExecutionFinalizer {
  constructor({
    session = null,
    turnPersister = null,
    resolveMemoryPostProcessAsyncEnabled = () => true,
    runMemoryPostProcessFlow = async () => {},
    resolveExecutionBundleTimeoutMs = () => 5000,
    upsertParentAsyncTask = () => {},
    now = () => new Date().toISOString(),
  } = {}) {
    this.session = session;
    this.turnPersister = turnPersister;
    this.resolveMemoryPostProcessAsyncEnabled = resolveMemoryPostProcessAsyncEnabled;
    this.runMemoryPostProcessFlow = runMemoryPostProcessFlow;
    this.resolveExecutionBundleTimeoutMs = resolveExecutionBundleTimeoutMs;
    this.upsertParentAsyncTask = upsertParentAsyncTask;
    this.now = now;
  }

  async finalizeRunSession({
    userId,
    sessionId,
    parentSessionId = "",
    parentDialogProcessId = "",
    caller = CALLER_ROLE.USER,
    dialogProcessId = "",
    turnScopeId = "",
    thinkingStartedAt = "",
    agentResult = {},
    alreadyPersistedTurnMessageCount = 0,
    persistedTurnMessageUids = [],
    persistedTurnMessages = null,
    durableTurnMessages = null,
    summaryCheckpointPromotionSources = [],
    executionStartIndex = 0,
    runtimeEventListener = null,
    userConfig = {},
    resolvedParentAsyncResultContainer = null,
    lifecycle = null,
    persistenceContext = null,
  }) {
    const activeTurnMessages =
      Array.isArray(agentResult?.turnMessages) && agentResult.turnMessages.length
        ? agentResult.turnMessages
        : [
            this.turnPersister.buildDefaultAssistantTurn({
              agentResult,
              dialogProcessId,
            }),
          ];
    const persistedActivePrefixCount = Math.min(
      activeTurnMessages.length,
      Math.max(0, Number(alreadyPersistedTurnMessageCount) || 0),
    );
    const hasRecoveredPersistedPrefix = Array.isArray(persistedTurnMessages);
    const persistedUidSet = new Set((Array.isArray(persistedTurnMessageUids)
      ? persistedTurnMessageUids
      : [])
      .map((uid) => String(uid || "").trim())
      .filter(Boolean));
    const activeMessageUids = new Set(activeTurnMessages
      .map((message = {}) => String(message.messageUid || "").trim())
      .filter(Boolean));
    const rawTurnMessages = hasRecoveredPersistedPrefix
      ? persistedUidSet.size > 0
        ? [
            ...persistedTurnMessages.filter((message = {}) => {
              const messageUid = String(message.messageUid || "").trim();
              return !messageUid || !activeMessageUids.has(messageUid);
            }),
            ...activeTurnMessages,
          ]
        : [...persistedTurnMessages, ...activeTurnMessages.slice(persistedActivePrefixCount)]
      : activeTurnMessages;
    const promotionSourceCount = Array.isArray(summaryCheckpointPromotionSources)
      ? summaryCheckpointPromotionSources.length
      : 0;
    const promotedMessages = promoteGeneratedTransfersToFinalAssistant([
      ...(Array.isArray(summaryCheckpointPromotionSources)
        ? summaryCheckpointPromotionSources
        : []),
      ...rawTurnMessages,
    ]);
    const turnMessages = promotedMessages.slice(promotionSourceCount);
    const persistedResultPrefixCount = hasRecoveredPersistedPrefix
      ? persistedTurnMessages.length
      : persistedActivePrefixCount;
    const promotedTurnMessages = promotedMessages.slice(promotionSourceCount);
    const durableMessages = Array.isArray(durableTurnMessages)
      ? durableTurnMessages
      : persistedTurnMessages;
    const persistedMessagesByUid = new Map(
      (Array.isArray(durableMessages) ? durableMessages : [])
        .map((message = {}) => [String(message.messageUid || "").trim(), message])
        .filter(([messageUid]) => messageUid),
    );
    for (const messageUid of persistedUidSet) {
      if (!persistedMessagesByUid.has(messageUid)) {
        throw new Error(
          `persisted turn message is missing from the durable journal: ${messageUid}`,
        );
      }
    }
    const messagesToPersist = persistedUidSet.size > 0
      ? promotedTurnMessages.filter((message = {}) => {
          const messageUid = String(message.messageUid || "").trim();
          if (!messageUid || !persistedUidSet.has(messageUid)) return true;
          const persistedMessage = persistedMessagesByUid.get(messageUid);
          return JSON.stringify(persistedMessage) !== JSON.stringify(message);
        })
      : promotedMessages.slice(promotionSourceCount + persistedResultPrefixCount);
    emitContextIdentityDebug(
      runtimeEventListener,
      "completedTurnSummaryPersistencePlanned",
      {
        userId,
        sessionId,
        parentSessionId,
        dialogProcessId,
        turnScopeId,
      },
      {
        activeMessageCount: activeTurnMessages.length,
        durableMessageCount: persistedMessagesByUid.size,
        persistedUidCount: persistedUidSet.size,
        messageToPersistCount: messagesToPersist.length,
        activeSummarizedMessageIds: summarizedMessageIds(activeTurnMessages),
        durableSummarizedMessageIds: summarizedMessageIds(durableMessages),
        persistedSummarizedMessageIds: summarizedMessageIds(messagesToPersist),
      },
    );
    const thinkingFinishedAt = this.now();

    lifecycle?.enterPersisting?.();
    await this.turnPersister.appendAgentMessages({
      userId,
      sessionId,
      parentSessionId,
      messages: messagesToPersist,
      dialogProcessId,
      parentDialogProcessId,
      turnScopeId: String(turnScopeId || "").trim(),
      thinkingStartedAt,
      thinkingFinishedAt,
      eventListener: runtimeEventListener,
      persistenceContext,
    });
    await this.session.upsertTurnTiming?.({
      userId,
      sessionId,
      parentSessionId,
      turnScopeId,
      dialogProcessId,
      thinkingFinishedAt,
      persistenceContext,
    });
    await this.session.saveCurrentTurnTasks({
      userId,
      sessionId,
      parentSessionId,
      currentTurnTasks: agentResult?.turnTasks || [],
      persistenceContext,
    });

    lifecycle?.enterMemory?.();
    const memoryPostProcessAsyncEnabled =
      this.resolveMemoryPostProcessAsyncEnabled(userConfig);
    if (memoryPostProcessAsyncEnabled) {
      emitEvent(runtimeEventListener, "memory_postprocess_scheduled", {
        sessionId,
        mode: "async",
      });
      Promise.resolve()
        .then(() =>
          this.runMemoryPostProcessFlow({
            userId,
            sessionId,
            parentSessionId,
            userConfig,
            runtimeEventListener,
            mode: "async",
            persistenceContext,
          }),
        )
        .catch(() => {
        });
    } else {
      await this.runMemoryPostProcessFlow({
        userId,
        sessionId,
        parentSessionId,
        userConfig,
        runtimeEventListener,
        mode: "sync",
        persistenceContext,
      });
    }

    lifecycle?.complete?.();
    await runtimeEventListener?.flushDelivery?.();
    await runtimeEventListener?.flushPersistence?.();

    const executionBundleTimeoutMs = this.resolveExecutionBundleTimeoutMs(userConfig);
    let executionLogs = [];
    try {
      const execution = await Promise.race([
        this.session.getExecutionBundle({
          userId,
          sessionId,
          parentSessionId,
          persistenceContext,
        }),
        new Promise((_, reject) =>
          setTimeout(
            () =>
              reject(
                new Error(
                  `execution bundle timeout after ${executionBundleTimeoutMs}ms`,
                ),
              ),
            executionBundleTimeoutMs,
          ),
        ),
      ]);
      executionLogs = (execution?.logs || []).slice(executionStartIndex);
    } catch (error) {
      emitEvent(runtimeEventListener, "execution_bundle_unavailable", {
        sessionId,
        timeoutMs: executionBundleTimeoutMs,
        error: error?.message || String(error),
      });
      executionLogs = [];
    }
    const executionSummary = summarizeExecutionLogs(executionLogs, { dialogProcessId });
    this.upsertParentAsyncTask({
      parentAsyncResultContainer: resolvedParentAsyncResultContainer,
      sessionId,
      parentSessionId,
      patch: {
        status: SESSION_ASYNC_STATUS.COMPLETED,
        endedAt: this.now(),
        error: "",
        result: {
          sessionId,
          parentSessionId: normalizeParentSessionId(parentSessionId),
          parentDialogProcessId: parentDialogProcessId || "",
          caller: String(caller || CALLER_ROLE.USER),
          answer: agentResult.output,
          traces: agentResult.traces,
          messages: turnMessages,
          turnTasks: agentResult?.turnTasks || [],
          executionLogs,
          executionSummary,
          dialogProcessId,
          turnScopeId: String(turnScopeId || "").trim(),
        },
      },
    });

    return {
      sessionId,
      parentSessionId: normalizeParentSessionId(parentSessionId),
      parentDialogProcessId: parentDialogProcessId || "",
      caller: String(caller || CALLER_ROLE.USER),
      answer: agentResult.output,
      traces: agentResult.traces,
      messages: turnMessages,
      turnTasks: agentResult?.turnTasks || [],
      executionLogs,
      executionSummary,
      dialogProcessId,
      turnScopeId: String(turnScopeId || "").trim(),
      lifecycle: lifecycle?.snapshot || null,
      ...(resolvedParentAsyncResultContainer
        ? { parentAsyncResultContainer: resolvedParentAsyncResultContainer }
        : {}),
    };
  }
}
