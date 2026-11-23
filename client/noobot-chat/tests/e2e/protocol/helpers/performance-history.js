/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { PERF_HISTORY } from "../../../../../../scripts/mock-model-service/performance-contract.mjs";
import { createSessionFacade } from "noobot-agent/session";

const HISTORY_MESSAGES_PER_STORAGE_BATCH = 2;

export async function seedPerformanceHistory(runtime, { userId, sessionId }) {
  const {
    turns: historyTurns,
    checkpointsPerTurn,
    messagesPerCheckpoint,
    minimumContentBytes,
  } = PERF_HISTORY;
  const session = createSessionFacade(runtime);
  const contentBytes =
    Math.ceil(minimumContentBytes / (historyTurns * checkpointsPerTurn * messagesPerCheckpoint)) +
    1;
  const content = "x".repeat(contentBytes);
  let historyMessages = 0;
  let historyCheckpoints = 0;
  let historyContentBytes = 0;
  const turnSamples = [];
  for (let turn = 0; turn < historyTurns; turn += 1) {
    const timing = { appendMs: 0, checkpointMs: 0, verificationMs: 0 };
    const turnScopeId = `performance-history-${turn}`;
    const persistedMessageUids = [];
    for (let checkpoint = 0; checkpoint < checkpointsPerTurn; checkpoint += 1) {
      const turns = Array.from({ length: messagesPerCheckpoint }, (_, index) => {
        const uid = `${turnScopeId}-${checkpoint}-${index}`;
        return {
          role: "assistant",
          attachments: [],
          transferEnvelopes: [],
          messageUid: uid,
          modelMessageId: `model-${uid}`,
          presentationMessageId: `pm_${turnScopeId}`,
          dialogProcessId: turnScopeId,
          turnScopeId,
          chatPresentation: false,
          summarized: false,
          content,
        };
      });
      let startedAt = performance.now();
      for (let index = 0; index < turns.length; index += HISTORY_MESSAGES_PER_STORAGE_BATCH) {
        await session.appendTurns({
          userId,
          sessionId,
          persistenceScope: null,
          turns: turns.slice(index, index + HISTORY_MESSAGES_PER_STORAGE_BATCH),
        });
      }
      timing.appendMs += performance.now() - startedAt;
      persistedMessageUids.push(...turns.map((message) => message.messageUid));
      startedAt = performance.now();
      await session.commitTurnSummaryCheckpoint({
        userId,
        sessionId,
        persistenceScope: null,
        dialogProcessId: turnScopeId,
        turnScopeId,
        checkpointId: `${turnScopeId}-checkpoint-${checkpoint}`,
        expectedCheckpointRevision: checkpoint,
        persistedMessageUids: [...persistedMessageUids],
        summarizedMessageUids: turns.map((message) => message.messageUid),
        retainedMessageUids: [],
        messages: [],
      });
      timing.checkpointMs += performance.now() - startedAt;
    }
    const verificationStartedAt = performance.now();
    const persistenceContext = runtime.createSessionPersistenceContext({
      userId,
      sessionId,
      persistenceScope: null,
    });
    await using reader = await runtime.repositories.sessionRepository.requireSessionReader(
      userId,
      sessionId,
      { persistenceContext },
    );
    const state = await reader.readCheckpointState(turnScopeId);
    if (
      state.checkpointRevision !== checkpointsPerTurn ||
      state.receipts.length !== checkpointsPerTurn
    )
      throw new Error("performance history checkpoint count mismatch");
    for (let checkpoint = 0; checkpoint < checkpointsPerTurn; checkpoint += 1) {
      const receipt = state.receipts[checkpoint];
      if (
        receipt.checkpointId !== `${turnScopeId}-checkpoint-${checkpoint}` ||
        receipt.checkpointRevision !== checkpoint + 1
      )
        throw new Error("performance history checkpoint identity mismatch");
      historyCheckpoints += 1;
    }
    for (
      let offset = 0;
      offset < persistedMessageUids.length;
      offset += HISTORY_MESSAGES_PER_STORAGE_BATCH
    ) {
      const messageUids = persistedMessageUids.slice(
        offset,
        offset + HISTORY_MESSAGES_PER_STORAGE_BATCH,
      );
      const records = await reader.readMessages({ messageUids });
      if (records.length !== messageUids.length)
        throw new Error("performance history message count mismatch");
      for (const [index, record] of records.entries()) {
        const messageUid = messageUids[index];
        if (record === null)
          throw new Error(`performance history message is missing: ${messageUid}`);
        const { message } = record;
        if (
          message.messageUid !== messageUid ||
          message.turnScopeId !== turnScopeId ||
          message.dialogProcessId !== turnScopeId ||
          message.summarized !== true ||
          message.content !== content
        )
          throw new Error("performance history message identity or content mismatch");
        historyMessages += 1;
        historyContentBytes += Buffer.byteLength(message.content);
      }
    }
    timing.verificationMs = performance.now() - verificationStartedAt;
    const sample = { turn, ...timing };
    turnSamples.push(sample);
    console.log("[performance-history]", JSON.stringify(sample));
  }
  if (historyContentBytes <= minimumContentBytes)
    throw new Error("performance history content must exceed its workload byte floor");
  return {
    historyTurns,
    historyMessages,
    historyCheckpoints,
    historyContentBytes,
    minimumHistoryContentBytes: minimumContentBytes,
    turnSamples,
  };
}
