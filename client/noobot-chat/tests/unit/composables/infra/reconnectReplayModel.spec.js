import { describe, expect, it } from "vitest";
import { RoleEnum, StreamEventEnum } from "../../../../src/shared/constants/chatConstants";
import {
  findLatestPendingAssistantAfterLastUser,
  findReconnectDoneEnvelopeWithMessages,
  findReusableMessageObject,
  isDialogProcessRecoverable,
  isReconnectTerminalBatch,
  mergeCurrentUserMessagesIntoFoldedMessages,
  patchMessageObjectPreservingUiState,
  splitReconnectMessagesByDialogProcessId,
} from "../../../../src/composables/infra/reconnectReplayModel";

describe("reconnectReplayModel", () => {
  it("isDialogProcessRecoverable respects running/pending interaction only", () => {
    expect(
      isDialogProcessRecoverable(
        { hasRunningTask: true },
        [{ event: StreamEventEnum.DELTA, data: { text: "x" } }],
      ),
    ).toBe(true);

    expect(
      isDialogProcessRecoverable(
        { hasRunningTask: false },
        [
          { event: StreamEventEnum.THINKING, data: {} },
          { event: StreamEventEnum.DELTA, data: { text: "history" } },
        ],
      ),
    ).toBe(false);

    expect(
      isDialogProcessRecoverable(
        { hasRunningTask: false },
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
      { event: StreamEventEnum.DELTA, data: { dialogProcessId: "dp-1", text: "a" } },
      { event: StreamEventEnum.DELTA, data: { dialogProcessId: "dp-2", text: "b" } },
      { event: StreamEventEnum.THINKING, data: { dialogProcessId: "dp-1" } },
    ]);

    expect(groups).toHaveLength(2);
    expect(groups.find((item) => item.dialogProcessId === "dp-1")?.messages).toHaveLength(2);
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

  it("patchMessageObjectPreservingUiState preserves running thinking timing fields", () => {
    const startedAt = "2026-06-22T10:00:00.000Z";
    const target = {
      role: "assistant",
      dialogProcessId: "dp-time",
      content: "partial",
      pending: true,
      channelState: { state: "sending", createdAt: startedAt, createdAtMs: Date.parse(startedAt) },
      thinkingStartedAt: startedAt,
      thinking_started_at: startedAt,
    };

    patchMessageObjectPreservingUiState(target, {
      role: "assistant",
      dialogProcessId: "dp-time",
      content: "partial from detail",
      pending: false,
    });

    expect(target.channelState).toMatchObject({ state: "sending", createdAt: startedAt });
    expect(target.thinkingStartedAt).toBe(startedAt);
    expect(target.thinking_started_at).toBeUndefined();
    expect(target.pending).toBe(true);
  });

  it("patchMessageObjectPreservingUiState keeps non-degrading fields and UI state", () => {
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
      expandedDetailLogKeys: ["k1"],
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
    expect(target.completedToolLogs).toHaveLength(1);
    expect(target.realtimeLogs).toHaveLength(1);
    expect(target.transferEnvelopes).toEqual([envelope]);
    expect(target.thinkingOpenNames).toEqual(["thinking-panel"]);
    expect(target.expandedDetailLogKeys).toEqual(["k1"]);
    expect(target.statusLabel).toBe("generated");
  });

  it("patchMessageObjectPreservingUiState merges incoming transfer envelopes", () => {
    const existingTransferEnvelope = {
      protocol: "noobot.semantic-transfer",
      version: 1,
      direction: "output",
      transport: "file",
      filePath: "/workspace/old.txt",
    };
    const incomingTransferEnvelope = {
      protocol: "noobot.semantic-transfer",
      version: 1,
      direction: "output",
      transport: "file",
      filePath: "/workspace/new.txt",
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

  it("findReusableMessageObject reuses assistant by dialogProcessId when turnScopeId is present", () => {
    const existing = [
      { role: RoleEnum.ASSISTANT, dialogProcessId: "dp-1", turnScopeId: "turn-1", content: "old" },
      { role: RoleEnum.ASSISTANT, dialogProcessId: "dp-2", turnScopeId: "turn-2", content: "other" },
    ];
    const reusable = findReusableMessageObject(
      { role: RoleEnum.ASSISTANT, dialogProcessId: "dp-2", turnScopeId: "turn-2", content: "new" },
      existing,
    );
    expect(reusable).toBe(existing[1]);
  });

  it("patchMessageObjectPreservingUiState clears stale artifacts when source assistant has no turnScopeId", () => {
    const target = {
      role: RoleEnum.ASSISTANT,
      dialogProcessId: "dp-stale",
      turnScopeId: "turn-old",
      attachments: [{ name: "old.txt" }],
      completedToolLogs: [{ id: "old-tool" }],
      realtimeLogs: [{ id: "old-realtime" }],
      processCompletedToolLogs: [{ id: "old-process" }],
      processRealtimeLogs: [{ id: "old-process-realtime" }],
      processExecutionLogTotal: 2,
    };

    patchMessageObjectPreservingUiState(target, {
      role: RoleEnum.ASSISTANT,
      dialogProcessId: "dp-stale",
      content: "new assistant without turn",
    });

    expect(target.turnScopeId).toBeUndefined();
    expect(target.attachments).toEqual([]);
    expect(target.completedToolLogs).toEqual([]);
    expect(target.realtimeLogs).toEqual([]);
    expect(target.processCompletedToolLogs).toEqual([]);
    expect(target.processRealtimeLogs).toEqual([]);
    expect(target.processExecutionLogTotal).toBe(0);
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
