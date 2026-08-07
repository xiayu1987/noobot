/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { describe, expect, it } from "vitest";
import { createReplayBatch } from "@noobot/event-protocol";
import { createTurnLifecycleSnapshot } from "@noobot/session-protocol";
import { RoleEnum, StreamEventEnum } from "../../../../../src/modules/chat/model/chatConstants.js";
import {
  findLatestPendingAssistantAfterLastUser,
  findReconnectDoneEnvelopeWithMessages,
  findReusableMessageObject,
  isDialogProcessRecoverable,
  isReconnectTerminalBatch,
  mergeCurrentUserMessagesIntoFoldedMessages,
  patchMessageObjectPreservingUiState,
  splitReconnectMessagesByDialogProcessId,
} from "../../../../../src/modules/chat/model/reconnectReplayModel.js";

describe("reconnectReplayModel", () => {
  it("isDialogProcessRecoverable respects running/pending interaction only", () => {
    const activeTurn = {
      sessionId: "s-1",
      turnScopeId: "turn-1",
      messageId: "message-1",
      presentationMessageId: "presentation-1",
      revision: 1,
      sequence: 1,
      state: "processing",
    };
    const snapshot = createTurnLifecycleSnapshot({
      commandId: "command-1",
      sessionId: "s-1",
      sequence: 1,
      activeTurnScopeId: "turn-1",
      activeTurn,
    });
    const runningBatch = createReplayBatch({ sessionId: "s-1", snapshot, snapshotSequence: 1 });
    expect(
      isDialogProcessRecoverable(
        { sessionId: "s-1", replayBatch: runningBatch },
        [{ event: StreamEventEnum.DELTA, data: { text: "x" } }],
      ),
    ).toBe(true);

    expect(
      isDialogProcessRecoverable(
        { sessionId: "s-1", replayBatch: createReplayBatch({
          sessionId: "s-1",
          snapshot: createTurnLifecycleSnapshot({
            commandId: "command-stopped", sessionId: "s-1", sequence: 1,
            activeTurnScopeId: "turn-stopped",
            activeTurn: { sessionId: "s-1", turnScopeId: "turn-stopped", messageId: "m-stopped", presentationMessageId: "p-stopped", revision: 1, sequence: 1, state: "stop_completed" },
          }), snapshotSequence: 1,
        }) },
        [{ event: StreamEventEnum.DELTA, data: { text: "history" } }],
      ),
    ).toBe(false);

    expect(
      isDialogProcessRecoverable(
        { sessionId: "s-1", replayBatch: createReplayBatch({ sessionId: "s-1", snapshot: null, snapshotSequence: 0 }) },
        [{ event: StreamEventEnum.DELTA, data: { text: "x" } }],
      ),
    ).toBe(false);

    expect(
      isDialogProcessRecoverable(
        { sessionId: "s-1", replayBatch: createReplayBatch({ sessionId: "s-1", snapshot: null, snapshotSequence: 0 }) },
        [
          { event: "message", data: {} },
          { event: StreamEventEnum.DELTA, data: { text: "history" } },
        ],
      ),
    ).toBe(false);

    expect(
      isDialogProcessRecoverable(
        { sessionId: "s-1", replayBatch: createReplayBatch({
          sessionId: "s-1", snapshot: null, snapshotSequence: 0,
          pendingInteractions: [{ requestId: "request-1", sessionId: "s-1", dialogProcessId: "dp-1", turnScopeId: "turn-1", payload: { type: "confirm" } }],
        }) },
        [
          {
            event: StreamEventEnum.INTERACTION_REQUEST,
            data: { __agentProxyPendingInteraction: true },
          },
        ],
      ),
    ).toBe(true);
  });

  it("splitReconnectMessagesByDialogProcessId splits mixed batches", () => {
    const groups = splitReconnectMessagesByDialogProcessId([
      { event: StreamEventEnum.DELTA, data: { dialogProcessId: "dp-1", turnScopeId: "turn-1", text: "a" } },
      { event: StreamEventEnum.DELTA, data: { dialogProcessId: "dp-2", text: "b" } },
      { event: "message", data: { dialogProcessId: "dp-1", turnScopeId: "turn-1" } },
      { event: StreamEventEnum.DELTA, data: { dialogProcessId: "dp-1", turnScopeId: "turn-2", text: "c" } },
    ]);

    expect(groups).toHaveLength(3);
    expect(groups.find((item) => item.turnScopeId === "turn-1")?.messages).toHaveLength(2);
    expect(groups.find((item) => item.turnScopeId === "turn-2")?.messages).toHaveLength(1);
    expect(groups.find((item) => item.dialogProcessId === "dp-2")?.messages).toHaveLength(1);
  });

  it("findLatestPendingAssistantAfterLastUser only searches after latest user", () => {
    const messages = [
      { role: RoleEnum.USER, content: "q1" },
      { role: RoleEnum.ASSISTANT, pending: true, content: "old pending" },
      { role: RoleEnum.USER, content: "q2" },
      { role: RoleEnum.ASSISTANT, pending: false, content: "done" },
      { role: RoleEnum.ASSISTANT, pending: true, content: "new pending" },
    ];
    expect(findLatestPendingAssistantAfterLastUser(messages)?.content).toBe("new pending");
  });

  it("detects terminal batch and finds DONE with messages", () => {
    const envelopes = [
      { event: StreamEventEnum.DELTA, data: { seq: 1 } },
      { event: StreamEventEnum.DONE, data: { messages: [{ role: RoleEnum.USER }] } },
    ];
    expect(isReconnectTerminalBatch(envelopes)).toBe(true);
    expect(findReconnectDoneEnvelopeWithMessages(envelopes)?.event).toBe(StreamEventEnum.DONE);
  });

  it("patchMessageObjectPreservingUiState does not overwrite runtime state from an unscoped detail patch", () => {
    const startedAt = "2026-06-22T10:00:00.000Z";
    const target = {
      role: "assistant",
      dialogProcessId: "dp-time",
      content: "partial",
      pending: true,
      channelState: { state: "sending", createdAt: startedAt, createdAtMs: Date.parse(startedAt) },
      thinkingStartedAt: startedAt,
      thinkingStartedAt: startedAt,
    };

    patchMessageObjectPreservingUiState(target, {
      role: "assistant",
      dialogProcessId: "dp-time",
      content: "partial from detail",
      pending: false,
    });

    expect(target.channelState).toMatchObject({ state: "sending", createdAt: startedAt });
    expect(target.thinkingStartedAt).toBe(startedAt);
    expect(target.pending).toBe(true);
  });

  it("patchMessageObjectPreservingUiState keeps non-degrading content and transfer fields", () => {
    const envelope = {
      protocol: "noobot.semantic-transfer",
      version: 1,
      direction: "output",
      transport: "file",
      filePath: "/workspace/a.txt",
    };
    const target = {
      content: "existing content",
      attachments: [{ name: "a.txt" }],
      modelRuns: [{ id: 1 }],
      completedToolLogs: [{ id: 1 }],
      realtimeLogs: [{ id: 1 }],
      transferEnvelopes: [envelope],
      thinkingOpenNames: ["thinking-panel"],
      expandedToolDetailKeys: ["k1"],
      statusLabel: "pending",
    };

    patchMessageObjectPreservingUiState(target, {
      content: "   ",
      attachments: [],
      modelRuns: [],
      completedToolLogs: [],
      realtimeLogs: [],
      statusLabel: "generated",
    });

    expect(target.content).toBe("existing content");
    expect(target.attachments).toHaveLength(1);
    expect(target.modelRuns).toHaveLength(1);
    expect(target.completedToolLogs).toEqual([{ id: 1 }]);
    expect(target.realtimeLogs).toEqual([{ id: 1 }]);
    expect(target.transferEnvelopes).toEqual([envelope]);
    expect(target.statusLabel).toBe("pending");
  });

  it("patchMessageObjectPreservingUiState merges incoming transfer envelopes", () => {
    const existingTransferEnvelope = {
      protocol: "noobot.semantic-transfer",
      version: 1,
      direction: "output",
      transport: "file",
      files: [{
        filePath: "/workspace/old.txt",
        attachmentMeta: {
          attachmentId: "old-transfer",
          sessionId: "session-transfer",
          attachmentSource: "test",
        },
      }],
    };
    const incomingTransferEnvelope = {
      protocol: "noobot.semantic-transfer",
      version: 1,
      direction: "output",
      transport: "file",
      files: [{
        filePath: "/workspace/new.txt",
        attachmentMeta: {
          attachmentId: "new-transfer",
          sessionId: "session-transfer",
          attachmentSource: "test",
        },
      }],
    };
    const target = {
      role: RoleEnum.ASSISTANT,
      transferEnvelopes: [existingTransferEnvelope],
    };

    patchMessageObjectPreservingUiState(target, {
      role: RoleEnum.ASSISTANT,
      transferEnvelopes: [incomingTransferEnvelope],
    });

    expect(target.transferEnvelopes).toEqual([existingTransferEnvelope, incomingTransferEnvelope]);
  });

  it("findReusableMessageObject does not reuse assistant by dialogProcessId without turnScopeId", () => {
    const existing = [
      { role: RoleEnum.ASSISTANT, dialogProcessId: "dp-1", content: "old" },
      { role: RoleEnum.ASSISTANT, dialogProcessId: "dp-2", content: "other" },
    ];
    const reusable = findReusableMessageObject(
      { role: RoleEnum.ASSISTANT, dialogProcessId: "dp-2", content: "new" },
      existing,
    );
    expect(reusable).toBeNull();
  });

  it("findReusableMessageObject reuses assistant only by presentationMessageId", () => {
    const existing = [
      { role: RoleEnum.ASSISTANT, presentationMessageId: "presentation-1", dialogProcessId: "dp-1", turnScopeId: "turn-1", content: "old" },
      { role: RoleEnum.ASSISTANT, presentationMessageId: "presentation-2", dialogProcessId: "dp-2", turnScopeId: "turn-2", content: "other" },
    ];
    const reusable = findReusableMessageObject(
      { role: RoleEnum.ASSISTANT, presentationMessageId: "presentation-2", dialogProcessId: "dp-2", turnScopeId: "turn-2", content: "new" },
      existing,
    );
    expect(reusable).toBe(existing[1]);
  });

  it("findReusableMessageObject does not guess assistant identity from a shared turn", () => {
    const existing = [{
      role: RoleEnum.ASSISTANT,
      presentationMessageId: "presentation-existing",
      turnScopeId: "turn-shared",
      toolTimeline: [{ key: "call:complete", args: { path: "README.md" } }],
    }];

    expect(findReusableMessageObject({
      role: RoleEnum.ASSISTANT,
      presentationMessageId: "presentation-next",
      turnScopeId: "turn-shared",
      toolCalls: [{ name: "read_file" }],
    }, existing)).toBeNull();
    expect(existing[0].toolTimeline[0].args).toEqual({ path: "README.md" });
  });

  it("patchMessageObjectPreservingUiState preserves authoritative thinking when a same-process snapshot omits turnScopeId", () => {
    const target = {
      role: RoleEnum.ASSISTANT,
      dialogProcessId: "dp-stale",
      turnScopeId: "turn-old",
      attachments: [{ name: "old.txt" }],
      completedToolLogs: [{ id: "old-tool" }],
      realtimeLogs: [{ id: "workflow-mermaid", text: "```mermaid\ngraph TD\nA-->B\n```" }],
      processCompletedToolLogs: [{ id: "old-process" }],
      processRealtimeLogs: [{ id: "old-process-realtime" }],
      processExecutionLogTotal: 2,
    };

    patchMessageObjectPreservingUiState(target, {
      role: RoleEnum.ASSISTANT,
      dialogProcessId: "dp-stale",
      content: "new assistant without turn",
    });

    expect(target.turnScopeId).toBe("turn-old");
    expect(target.attachments).toEqual([{ name: "old.txt" }]);
    expect(target.completedToolLogs).toEqual([{ id: "old-tool" }]);
    expect(target.realtimeLogs).toEqual([
      { id: "workflow-mermaid", text: "```mermaid\ngraph TD\nA-->B\n```" },
    ]);
    expect(target.processCompletedToolLogs).toEqual([{ id: "old-process" }]);
    expect(target.processRealtimeLogs).toEqual([{ id: "old-process-realtime" }]);
    expect(target.processExecutionLogTotal).toBe(2);
  });

  it("patchMessageObjectPreservingUiState rejects an unscoped snapshot for an already scoped assistant", () => {
    const target = {
      role: RoleEnum.ASSISTANT,
      dialogProcessId: "dp-old",
      turnScopeId: "turn-old",
      realtimeLogs: [{ id: "old-realtime" }],
      completedToolLogs: [{ id: "old-tool" }],
    };

    patchMessageObjectPreservingUiState(target, {
      role: RoleEnum.ASSISTANT,
      dialogProcessId: "dp-new",
      content: "different process snapshot",
    });

    expect(target.turnScopeId).toBe("turn-old");
    expect(target.realtimeLogs).toEqual([{ id: "old-realtime" }]);
    expect(target.completedToolLogs).toEqual([{ id: "old-tool" }]);
  });

  it("patchMessageObjectPreservingUiState keeps running assistant turnScopeId for stop after refresh", () => {
    const target = {
      role: RoleEnum.ASSISTANT,
      dialogProcessId: "dp-running",
      turnScopeId: "turn-running",
      pending: true,
      channelState: {
        state: "sending",
        dialogProcessId: "dp-running",
        turnScopeId: "turn-running",
      },
      attachments: [{ name: "running.txt" }],
      completedToolLogs: [{ id: "tool-running" }],
      realtimeLogs: [{ id: "log-running" }],
    };

    patchMessageObjectPreservingUiState(target, {
      role: RoleEnum.ASSISTANT,
      dialogProcessId: "dp-running",
      content: "running assistant from replay without turn",
    });

    expect(target.turnScopeId).toBe("turn-running");
    expect(target.channelState).toMatchObject({ state: "sending", turnScopeId: "turn-running" });
    expect(target.pending).toBe(true);
  });

  it("findReusableMessageObject rejects dialogProcessId reuse when turn identity conflicts", () => {
    const existing = [
      { role: RoleEnum.ASSISTANT, dialogProcessId: "dp-1", turnScopeId: "client-old", content: "old" },
      { role: RoleEnum.ASSISTANT, dialogProcessId: "dp-2", turnScopeId: "turn-old", content: "other" },
    ];

    expect(
      findReusableMessageObject(
        { role: RoleEnum.ASSISTANT, dialogProcessId: "dp-1", turnScopeId: "client-new", content: "new" },
        existing,
      ),
    ).toBeNull();
    expect(
      findReusableMessageObject(
        { role: RoleEnum.ASSISTANT, dialogProcessId: "dp-2", turnScopeId: "turn-new", content: "new" },
        existing,
      ),
    ).toBeNull();
  });

  it("mergeCurrentUserMessagesIntoFoldedMessages keeps missing user messages", () => {
    const currentUser = { role: RoleEnum.USER, content: "local user", ts: 2000 };
    const merged = mergeCurrentUserMessagesIntoFoldedMessages({
      foldedMessages: [{ role: RoleEnum.ASSISTANT, content: "server", ts: 3000 }],
      existingMessages: [currentUser],
    });
    expect(merged.some((message) => message === currentUser)).toBe(true);
    expect(merged.map((message) => message.role)).toEqual([RoleEnum.USER, RoleEnum.ASSISTANT]);
  });
});
