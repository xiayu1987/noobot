/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { PERF_HISTORY } from "../../../../../../scripts/mock-model-service/performance-contract.mjs";
import { createSessionServices, createSessionFacade } from "noobot-agent/session";
import { AttachmentService } from "noobot-agent/attach";
import { collectNoobotPluginScopedSessionRootDeclarations } from "@noobot/plugin-runtime";
import { resolveScopedSessionRoots } from "@noobot/workspace-protocol";
import { workspaceRoot } from "./persistence-audit.js";

export async function seedPerformanceHistory({ userId, sessionId }) {
  const {
    turns: historyTurns,
    checkpointsPerTurn,
    messagesPerCheckpoint,
    minimumContentBytes,
  } = PERF_HISTORY;
  const globalConfig = { workspaceRoot: workspaceRoot() };
  const runtime = createSessionServices(globalConfig, {
    now: () => new Date().toISOString(),
    attachmentService: new AttachmentService(globalConfig),
    scopedSessionRoots: resolveScopedSessionRoots(
      await collectNoobotPluginScopedSessionRootDeclarations(),
    ),
  });
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
      await session.appendTurns({ userId, sessionId, persistenceScope: null, turns });
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
    const query = {
      userId,
      sessionId,
      persistenceScope: null,
      turnScopeId,
      dialogProcessId: turnScopeId,
    };
    const state = await session.getTurnSummaryCheckpointState(query);
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
      const messageUids = persistedMessageUids.slice(
        checkpoint * messagesPerCheckpoint,
        (checkpoint + 1) * messagesPerCheckpoint,
      );
      const sources = await session.getSessionMessageSources({
        ...query,
        turnScopeIds: [turnScopeId],
        messageUids,
      });
      if (sources.length !== messageUids.length)
        throw new Error("performance history message count mismatch");
      for (let index = 0; index < sources.length; index += 1) {
        const message = sources[index];
        if (
          message.messageUid !== messageUids[index] ||
          message.turnScopeId !== turnScopeId ||
          message.dialogProcessId !== turnScopeId ||
          message.summarized !== true ||
          typeof message.content !== "string" ||
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
