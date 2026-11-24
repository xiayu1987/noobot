/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { countCanonicalThinkingDetailEvents } from "@noobot/event-protocol/tool-timeline";
import { SESSION_ERROR_CODE } from "@noobot/session-protocol";
import { PARTITION_JOURNAL_HEAD_FILE } from "@noobot/session-protocol/partition-journal";
import { PARTITION_MESSAGE_COLLECTIONS } from "@noobot/session-protocol/partition-session-messages";
import { createTurnArtifactRevision } from "@noobot/session-protocol/turn-lookup-key";
import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtemp, rm } from "node:fs/promises";
import { PartitionTransactions } from "../../src/session/partition-storage/partition-transactions.js";
import { partitionReaderAccess } from "../helpers/partition-reader-fixture.js";
import { createSessionRepositoryFixture } from "../helpers/session-repository-fixture.js";
import {
  buildThinkingDetailPayload,
  buildThinkingDetailPagePayload,
} from "@noobot/event-protocol/thinking-detail-projection";
import { readSessionThinkingDetail } from "../../src/session/session-thinking-detail.js";
import { SessionPageSnapshots } from "../../src/session/session-page-snapshots.js";
import {
  canonicalActivity,
  canonicalToolTimelineItem,
  fileToolResultText,
} from "./session-repository-boundary.summaries.fixtures.js";

function guardThinkingDetailReads(read) {
  const { messages, content } = PARTITION_MESSAGE_COLLECTIONS;
  return Object.assign((query) => {
    if (query.collection === messages)
      assert.ok(!query.keys.includes("sm-one"), "unselected message record must not be read");
    if (query.collection === content)
      assert.ok(
        !query.keys.some((key) => JSON.parse(key)[0] === "sm-two"),
        "ordinary body must not be read",
      );
    return read(query);
  }, read);
}

function completedReadTool(toolCallId, { call, resultEvent }) {
  return canonicalToolTimelineItem({
    toolCallId,
    tool: "read_file",
    args: { filePath: `${toolCallId}.txt` },
    call,
    result: fileToolResultText(`${toolCallId}.txt`, { content: toolCallId }),
    success: true,
    resultEvent,
  });
}
import {
  applySessionMessageFacts,
  createTestSessionRequiredFields,
} from "../helpers/session-message-facts.js";
import { TEST_MESSAGE_TS } from "../helpers/session-run-payload.js";
import { buildFixtureDisplaySummary } from "../helpers/session-projection-fixture.js";
import { seedPartitionSession } from "../helpers/partition-session-seed.js";

const TEST_TURN_ID = "turn-000001";
const TEST_COMMITTED_BYTES = 128;

function committedTurn({ sessionId, turnScopeId, dialogProcessId, messages }) {
  return {
    sessionId,
    turnId: TEST_TURN_ID,
    artifactOrdinal: 1,
    committedBytes: TEST_COMMITTED_BYTES,
    turnScopeId,
    dialogProcessId,
    messages: messages.map((message) => ({ sessionId, turnScopeId, dialogProcessId, ...message })),
    summarySnapshots: [],
  };
}

test("thinking detail message carries its Turn identity without duplicating scoped messages", () => {
  const payload = buildThinkingDetailPayload(
    committedTurn({
      sessionId: "session-detail",
      turnScopeId: "turn-detail",
      dialogProcessId: "dialog-detail",
      messages: [
        {
          attachments: [],
          messageUid: "final-assistant-source",
          ts: TEST_MESSAGE_TS,
          role: "assistant",
          presentationMessageId: "pm_turn_detail",
          modelMessageId: "mm_session_thinking_detail__1",
          type: "message",
          toolTimeline: [
            completedReadTool("one", {
              call: { eventId: "call-one" },
              resultEvent: { eventId: "result-one" },
            }),
          ],
        },
        {
          attachments: [],
          messageUid: "guidance-source",
          ts: TEST_MESSAGE_TS,
          role: "assistant",
          presentationMessageId: "pm_turn_detail",
          modelMessageId: "mm_session_thinking_detail__2",
          type: "message",
          injectedMessage: true,
          content: "guidance",
        },
      ],
    }),
  );

  assert.equal(payload.exists, true);
  assert.equal(payload.sessionId, "session-detail");
  assert.deepEqual(
    {
      sessionId: payload.messageItem.sessionId,
      turnScopeId: payload.messageItem.turnScopeId,
      dialogProcessId: payload.messageItem.dialogProcessId,
      presentationMessageId: payload.messageItem.presentationMessageId,
    },
    {
      sessionId: "session-detail",
      turnScopeId: "turn-detail",
      dialogProcessId: "dialog-detail",
      presentationMessageId: "pm_turn_detail",
    },
  );
  assert.equal(Object.hasOwn(payload, "allMessages"), false);
  assert.equal(payload.counts.injectedMessageCount, 1);
  assert.deepEqual(payload.messageItem.thinkingContentTimeline, [
    {
      contentId: "message:guidance-source",
      contentKind: "injected_message",
      sourceMessageUid: "guidance-source",
      text: "guidance",
      timestamp: TEST_MESSAGE_TS,
      sequence: 2,
      sessionId: "session-detail",
      dialogProcessId: "dialog-detail",
      turnScopeId: "turn-detail",
      presentationMessageId: "pm_turn_detail",
    },
  ]);
  assert.equal(payload.counts.thinkingContentCount, 1);
});

test("thinking detail projects only activity facts, not assistant tool-call content, and excludes control injections", () => {
  const payload = buildThinkingDetailPayload(
    committedTurn({
      sessionId: "content-session",
      turnScopeId: "content-turn",
      dialogProcessId: "content-dialog",
      messages: [
        {
          attachments: [],
          messageUid: "assistant-tool-source",
          ts: TEST_MESSAGE_TS,
          modelMessageId: "presentation-content",
          role: "assistant",
          type: "tool_call",
          presentationMessageId: "presentation-content",
          content: "先确认当前真实状态。",
          toolTimeline: [
            completedReadTool("one", {
              call: { eventId: "call-one" },
              resultEvent: { eventId: "result-one" },
            }),
          ],
          activityTimeline: [
            canonicalActivity({
              eventId: "model-content-event",
              activityKind: "model_analysis",
              sessionId: "content-session",
              dialogProcessId: "content-dialog",
              turnScopeId: "content-turn",
              presentationMessageId: "presentation-content",
            }),
          ],
        },
        {
          attachments: [],
          messageUid: "control-source",
          ts: TEST_MESSAGE_TS,
          role: "user",
          type: "context_control",
          injectedMessage: true,
          noobotInternalMessageType: "noobot.task_check_prompt",
          content: "hidden control prompt",
        },
        {
          attachments: [],
          messageUid: "final-source",
          ts: TEST_MESSAGE_TS,
          role: "assistant",
          presentationMessageId: "presentation-content",
          modelMessageId: "mm_session_thinking_detail__3",
          type: "message",
          content: "done",
        },
      ],
    }),
  );

  assert.deepEqual(
    payload.messageItem.thinkingContentTimeline.map((item) => [item.contentKind, item.text]),
    [["thinking", "analysis"]],
  );
  assert.equal(payload.counts.injectedMessageCount, 0);
  assert.equal(payload.counts.thinkingContentCount, 1);
});

test("thinking detail projects the complete Turn timeline onto the Turn presentation", () => {
  const payload = buildThinkingDetailPayload(
    committedTurn({
      sessionId: "child-session",
      turnScopeId: "workflow-node:turn-1",
      dialogProcessId: "dialog-workflow-node",
      messages: [
        {
          attachments: [],
          messageUid: "sm-tool-call-message",
          ts: TEST_MESSAGE_TS,
          role: "assistant",
          presentationMessageId: "final-assistant",
          modelMessageId: "mm_session_thinking_detail__4",
          type: "tool_call",
          toolTimeline: [
            canonicalToolTimelineItem({
              toolCallId: "one",
              tool: "read_file",
              args: { filePath: "one.txt" },
              call: { eventId: "call-start" },
            }),
          ],
        },
        {
          attachments: [],
          messageUid: "sm-tool-result-message",
          ts: TEST_MESSAGE_TS,
          role: "tool",
          presentationMessageId: "final-assistant",
          type: "tool_result",
          toolTimeline: [
            completedReadTool("one", {
              call: { eventId: "call-start" },
              resultEvent: { eventId: "call-end" },
            }),
          ],
        },
        {
          attachments: [],
          messageUid: "sm-final-assistant",
          ts: TEST_MESSAGE_TS,
          role: "assistant",
          presentationMessageId: "final-assistant",
          modelMessageId: "mm_session_thinking_detail__5",
          type: "message",
          content: "done",
          activityTimeline: [
            canonicalActivity({
              eventId: "analysis-1",
              sessionId: "child-session",
              dialogProcessId: "dialog-workflow-node",
              turnScopeId: "workflow-node:turn-1",
              presentationMessageId: "final-assistant",
            }),
          ],
        },
      ],
    }),
  );

  assert.equal(payload.messageItem.presentationMessageId, "final-assistant");
  assert.equal(payload.messageItem.toolTimeline.length, 1);
  assert.equal(payload.messageItem.toolTimeline[0].status, "completed");
  assert.equal(payload.messageItem.toolTimeline[0].call.eventId, "call-start");
  assert.equal(payload.messageItem.toolTimeline[0].resultEvent.eventId, "call-end");
  assert.equal(payload.messageItem.activityTimeline.length, 1);
  assert.equal(payload.messageItem.hasThinkingDetails, true);
  assert.equal(payload.counts.executionLogCount, 2);
});

test("thinking detail revision is the committed Turn journal position", () => {
  const turn = committedTurn({
    sessionId: "revision-session",
    turnScopeId: "revision-turn",
    dialogProcessId: "revision-dialog",
    messages: [
      {
        attachments: [],
        role: "assistant",
        presentationMessageId: "pm_fx7",
        modelMessageId: "mm_session_thinking_detail__6",
        type: "message",
      },
    ],
  });

  const payload = buildThinkingDetailPayload(turn);

  assert.equal(payload.revision, createTurnArtifactRevision(turn));
  assert.equal(payload.revision, `turn-journal:${TEST_TURN_ID}:${TEST_COMMITTED_BYTES}`);
});

test("thinking detail of an uncommitted Turn does not exist", () => {
  assert.deepEqual(buildThinkingDetailPayload(null), { exists: false });
});

test("thinking detail rejects a Turn whose records carry conflicting presentation identities", () => {
  assert.throws(
    () =>
      buildThinkingDetailPayload(
        committedTurn({
          sessionId: "conflict-session",
          turnScopeId: "conflict-turn",
          dialogProcessId: "conflict-dialog",
          messages: [
            {
              attachments: [],
              role: "assistant",
              presentationMessageId: "pm_one",
              type: "message",
            },
            {
              attachments: [],
              role: "assistant",
              presentationMessageId: "pm_two",
              type: "message",
            },
          ],
        }),
      ),
    { code: SESSION_ERROR_CODE.TURN_IDENTITY_CONFLICT },
  );
});

test("stopped Turn detail uses the persisted presentation identity without a final answer", () => {
  const payload = buildThinkingDetailPayload(
    committedTurn({
      sessionId: "stopped-session",
      turnScopeId: "stopped-turn",
      dialogProcessId: "stopped-dialog",
      messages: [
        {
          attachments: [],
          messageUid: "sm-tool-call-message",
          ts: TEST_MESSAGE_TS,
          role: "assistant",
          modelMessageId: "mm_session_thinking_detail__7",
          type: "tool_call",
          chatPresentation: false,
          presentationMessageId: "stopped-presentation",
          toolTimeline: [
            completedReadTool("one", {
              call: { eventId: "call-one" },
              resultEvent: { eventId: "result-one" },
            }),
          ],
        },
      ],
    }),
  );

  assert.equal(payload.exists, true);
  assert.equal(payload.messageItem.presentationMessageId, "stopped-presentation");
  assert.equal(payload.messageItem.turnScopeId, "stopped-turn");
  assert.equal(payload.messageItem.dialogProcessId, "stopped-dialog");
  assert.equal(Object.hasOwn(payload.messageItem, "role"), false);
  assert.equal(Object.hasOwn(payload.messageItem, "thinkingDetailCount"), false);
  assert.equal(countCanonicalThinkingDetailEvents(payload.messageItem), 2);
  assert.equal(payload.counts.executionLogCount, 2);
});

test("session summary references canonical thinking detail without copying its timeline", async () => {
  const messages = [
    {
      attachments: [],
      modelMessageId: "tool-call-one",
      role: "assistant",
      presentationMessageId: "final-assistant",
      type: "tool_call",
      tool_calls: [{ id: "one", name: "read_file", args: {}, type: "tool_call" }],
      content: "",
      turnScopeId: "workflow-node:turn-2",
      dialogProcessId: "dialog-workflow-node",
      toolTimeline: [
        completedReadTool("one", {
          call: { eventId: "call-one" },
          resultEvent: { eventId: "result-one" },
        }),
      ],
    },
    {
      attachments: [],
      modelMessageId: "tool-call-two",
      role: "assistant",
      presentationMessageId: "final-assistant",
      type: "tool_call",
      tool_calls: [{ id: "two", name: "read_file", args: {}, type: "tool_call" }],
      content: "",
      turnScopeId: "workflow-node:turn-2",
      dialogProcessId: "dialog-workflow-node",
      toolTimeline: [
        completedReadTool("two", {
          call: { eventId: "call-two" },
          resultEvent: { eventId: "result-two" },
        }),
      ],
    },
    {
      attachments: [],
      modelMessageId: "final-assistant",
      presentationMessageId: "final-assistant",
      role: "assistant",
      type: "message",
      turnScopeId: "workflow-node:turn-2",
      dialogProcessId: "dialog-workflow-node",
      content: "done",
    },
  ];

  const summary = buildFixtureDisplaySummary({
    sessionId: "child-session",
    aggregateVersion: 0,
    messages,
  });
  const summaryMessage = summary.messages.find(
    (item) => item.presentationMessageId === "final-assistant",
  );
  const detail = buildThinkingDetailPayload(
    committedTurn({
      sessionId: "child-session",
      turnScopeId: "workflow-node:turn-2",
      dialogProcessId: "dialog-workflow-node",
      messages,
    }),
  );

  assert.equal(Object.hasOwn(summaryMessage, "thinkingDetailCount"), false);
  assert.equal(summaryMessage.hasThinkingDetails, true);
  assert.equal(Object.hasOwn(summaryMessage, "toolTimeline"), false);
  assert.equal(Object.hasOwn(summaryMessage, "activityTimeline"), false);
  assert.equal(summary.stats.thinkingMessageCount, 1);
  assert.equal(countCanonicalThinkingDetailEvents(detail.messageItem), 4);
  assert.equal(detail.messageItem.toolTimeline.length, 2);
});

test("session summary does not copy large tool payloads retained by thinking detail", async () => {
  const largePayload = "x".repeat(512 * 1024);
  const messages = [
    {
      attachments: [],
      messageUid: "sm-final-assistant",
      ts: TEST_MESSAGE_TS,
      role: "assistant",
      presentationMessageId: "pm_fx10",
      modelMessageId: "mm_session_thinking_detail__8",
      type: "message",
      turnScopeId: "turn-large-detail",
      content: "done",
      toolTimeline: [
        canonicalToolTimelineItem({
          toolCallId: "large",
          tool: "write_file",
          args: { filePath: "large.txt", content: largePayload },
          call: { eventId: "call-large" },
          result: fileToolResultText("large.txt", { content: "saved" }),
          success: true,
          resultEvent: { eventId: "result-large" },
        }),
      ],
    },
  ];

  const summary = buildFixtureDisplaySummary({
    sessionId: "large-session",
    aggregateVersion: 0,
    messages,
  });
  const detail = buildThinkingDetailPayload(
    committedTurn({
      sessionId: "large-session",
      turnScopeId: "turn-large-detail",
      dialogProcessId: "dialog-large-detail",
      messages,
    }),
  );

  assert.equal(JSON.stringify(summary).includes(largePayload), false);
  assert.equal(Object.hasOwn(summary.messages[0], "thinkingDetailCount"), false);
  assert.equal(Object.hasOwn(summary.messages[0], "toolTimeline"), false);
  assert.equal(summary.messages[0].hasThinkingDetails, true);
  assert.equal(summary.stats.thinkingMessageCount, 1);
  assert.equal(countCanonicalThinkingDetailEvents(detail.messageItem), 2);
  assert.equal(detail.messageItem.toolTimeline[0].args.content, largePayload);
  assert.equal(JSON.parse(detail.messageItem.toolTimeline[0].result).content, "saved");
  assert.equal(Object.hasOwn(detail, "allMessages"), false);
});

async function withSessionDir(fn) {
  const sessionDir = await mkdtemp(path.join(os.tmpdir(), "noobot-thinking-turn-"));
  try {
    await fn(sessionDir);
  } finally {
    await rm(sessionDir, { recursive: true, force: true });
  }
}

test("partition thinking detail reads only the selected turn and skips ordinary bodies", async (t) =>
  withSessionDir(async (sessionDir) => {
    await seedPartitionSession({
      sessionDir,
      sessionPayload: applySessionMessageFacts({
        ...createTestSessionRequiredFields(),
        sessionId: "scoped-session",
        aggregateVersion: 0,
        messages: [
          {
            attachments: [],
            messageUid: "sm-one",
            ts: TEST_MESSAGE_TS,
            sessionId: "scoped-session",
            role: "assistant",
            presentationMessageId: "pm_fx11",
            modelMessageId: "mm_session_thinking_detail__9",
            type: "message",
            turnScopeId: "turn-one",
            dialogProcessId: "dialog-one",
            content: "one",
            toolTimeline: [
              completedReadTool("one", {
                call: { eventId: "call-one" },
                resultEvent: { eventId: "result-one" },
              }),
            ],
          },
          {
            attachments: [],
            messageUid: "sm-two",
            ts: TEST_MESSAGE_TS,
            sessionId: "scoped-session",
            role: "assistant",
            presentationMessageId: "pm_fx12",
            modelMessageId: "mm_session_thinking_detail__10",
            type: "message",
            turnScopeId: "turn-two",
            dialogProcessId: "dialog-two",
            content: "two",
            toolTimeline: [
              completedReadTool("two", {
                call: { eventId: "call-two" },
                resultEvent: { eventId: "result-two" },
              }),
            ],
          },
        ],
      }),
    });
    const original = PartitionTransactions.prototype.withCollectionReader;
    t.mock.method(
      PartitionTransactions.prototype,
      "withCollectionReader",
      function (snapshot, operation, options) {
        return original.call(
          this,
          snapshot,
          (read) => operation(guardThinkingDetailReads(read)),
          options,
        );
      },
    );

    const lookupKey = { turnScopeId: "turn-two", dialogProcessId: "dialog-two" };
    await using snapshots = new SessionPageSnapshots();
    const pageSnapshots = snapshots.withReadAuthority(async () => {});
    const selection = { sessionId: "scoped-session", ...lookupKey, cursor: null, limit: 1 };
    const read = (key) =>
      readSessionThinkingDetail({
        pageSnapshots,
        identity: [sessionDir],
        open: () => partitionReaderAccess.openArtifact({ sessionDir }),
        ...selection,
        lookupKey: key,
      });
    const page = await read(lookupKey);
    assert.deepEqual(
      page.messages.map(({ messageUid }) => messageUid),
      ["sm-two"],
    );
    const detail = buildThinkingDetailPagePayload(page, selection);
    assert.equal(detail.exists, true);
    assert.equal(detail.sessionId, "scoped-session");
    assert.equal(detail.page.count, 1);
    assert.equal(detail.page.nextCursor, null);
    assert.equal(detail.messageItem.presentationMessageId, "pm_fx12");
    assert.equal(detail.messageItem.toolTimeline.length, 1);
    await using reader = await partitionReaderAccess.openArtifact({ sessionDir });
    await assert.rejects(
      reader.readMessageContentPage({
        messageUid: "sm-two",
        byteOffset: 0,
        maxBytes: 64,
        expectedContentReference: null,
      }),
      /ordinary body must not be read/,
    );
    await assert.rejects(
      reader.readMessageContentPage({
        messageUid: "sm-one",
        byteOffset: 0,
        maxBytes: 64,
        expectedContentReference: null,
      }),
      /unselected message record must not be read/,
    );

    assert.deepEqual(
      await read({
        turnScopeId: "turn-two",
        dialogProcessId: "dialog-one",
      }),
      { exists: false },
    );
  }));

test("thinking detail preserves tool pairing, activity order and relay replacement across storage pages", async () =>
  withSessionDir(async (sessionDir) => {
    const sessionId = "cross-page-session";
    const lookupKey = { turnScopeId: "cross-page-turn", dialogProcessId: "cross-page-dialog" };
    const identity = { sessionId, ...lookupKey, presentationMessageId: "cross-page-presentation" };
    const assistant = (messageUid, fields = {}) => ({
      ...identity,
      attachments: [],
      messageUid,
      modelMessageId: messageUid,
      role: "assistant",
      type: "message",
      ts: TEST_MESSAGE_TS,
      content: "ordinary response",
      ...fields,
    });
    const activity = (name, sequence) =>
      canonicalActivity({ ...identity, eventId: name, activityId: name, sequence });
    const first = assistant("cross-page-first", {
      toolTimeline: [
        canonicalToolTimelineItem({
          toolCallId: "paired-tool",
          tool: "read_file",
          args: { filePath: "paired-tool.txt" },
          call: { eventId: "paired-call" },
        }),
      ],
      activityTimeline: [
        activity("duplicate-activity", 1),
        { ...activity("relayed-activity", 2), relayCorrelationId: "cross-page-relay" },
      ],
    });
    const pageSize = 2;
    const last = assistant("cross-page-last", {
      toolTimeline: [
        completedReadTool("paired-tool", {
          call: { eventId: "paired-call" },
          resultEvent: { eventId: "paired-result" },
        }),
      ],
      activityTimeline: [activity("new-activity", 3), activity("duplicate-activity", 4)],
    });
    const injected = assistant("cross-page-injected", {
      injectedMessage: true,
      relayCorrelationId: "cross-page-relay",
      content: "relayed detail",
    });
    await seedPartitionSession({
      sessionDir,
      sessionPayload: applySessionMessageFacts({
        ...createTestSessionRequiredFields(),
        sessionId,
        aggregateVersion: 0,
        messages: [
          first,
          ...Array.from({ length: pageSize - 1 }, (_, index) => assistant(`filler-${index}`)),
          last,
          injected,
        ],
      }),
    });

    await using reader = await partitionReaderAccess.openArtifact({ sessionDir });
    const options = { lookupKey, cursor: null, limit: pageSize };
    const firstPage = await reader.readThinkingDetailPage(options);
    assert.equal(firstPage.messageCount, pageSize + 2);
    assert.equal(firstPage.records.length, pageSize);
    assert.equal(firstPage.records[0].message.content, null);
    const lastPage = await reader.readThinkingDetailPage({
      ...options,
      cursor: firstPage.nextCursor,
    });
    assert.equal(lastPage.nextCursor, null);
    assert.deepEqual(
      lastPage.records.map(({ turnOrdinal }) => turnOrdinal),
      [pageSize + 1, pageSize + 2],
    );
    assert.equal(lastPage.records[0].message.toolTimeline[0].resultEvent.eventId, "paired-result");
    assert.equal(lastPage.records[1].message.content, "relayed detail");
    await assert.rejects(
      reader.readScopedTurnMessagePage({ ...options, cursor: firstPage.nextCursor }),
      { code: "SESSION_PAGE_CURSOR_CONFLICT" },
    );
    await assert.rejects(reader.readThinkingDetailPage({ ...options, maxBytes: 1 }), {
      code: "SESSION_MESSAGE_READ_BUDGET_EXCEEDED",
    });

    const { messageItem, counts } = buildThinkingDetailPayload({
      sessionId,
      ...lookupKey,
      contentRevision: "test-pages",
      messages: [...firstPage.records, ...lastPage.records].map(({ message }) => message),
    });
    assert.deepEqual(
      messageItem.toolTimeline.map(({ status, resultEvent }) => [status, resultEvent.eventId]),
      [["completed", "paired-result"]],
    );
    assert.deepEqual(
      messageItem.activityTimeline.map(({ eventId, sequence }) => [eventId, sequence]),
      [
        ["relayed-activity", 2],
        ["new-activity", 3],
        ["duplicate-activity", 4],
      ],
    );
    assert.deepEqual(
      messageItem.thinkingContentTimeline
        .filter(({ sourceEventId }) => sourceEventId)
        .map(({ contentId }) => contentId),
      ["event:new-activity", "event:duplicate-activity"],
    );
    assert.equal(
      messageItem.thinkingContentTimeline.find(({ sourceMessageUid }) => sourceMessageUid)
        ?.sequence,
      pageSize + 2,
    );
    assert.equal(counts.executionLogCount, 2);
    assert.equal(counts.thinkingContentCount, 3);
  }));

test("thinking detail lookup requires both Turn identities", async () => {
  for (const lookupKey of [
    { turnScopeId: "turn-two" },
    { dialogProcessId: "dialog-two" },
    { turnScopeId: "turn-two", dialogProcessId: "" },
    { turnScopeId: " turn-two ", dialogProcessId: "dialog-two" },
  ]) {
    await assert.rejects(readSessionThinkingDetail({ lookupKey }), {
      code: SESSION_ERROR_CODE.TURN_LOOKUP_KEY_INVALID,
      statusCode: 400,
    });
  }
});

test("thinking detail distinguishes an absent session from a partition session missing CURRENT", async (t) => {
  const {
    services: { repository, persistenceContext },
    scope,
  } = await createSessionRepositoryFixture(t);
  const read = (sessionId, context) =>
    repository.readSessionThinkingDetail("u1", sessionId, {
      persistenceContext: context,
      lookupKey: { turnScopeId: "turn-two", dialogProcessId: "dialog-two" },
      cursor: null,
      limit: 1,
    });
  await assert.rejects(
    read("missing-session", repository.treePersistenceContext("u1", "missing-session")),
    {
      code: SESSION_ERROR_CODE.SESSION_NOT_FOUND,
    },
  );
  await rm(path.join(scope.sessionDir, PARTITION_JOURNAL_HEAD_FILE));
  await assert.rejects(read("s1", persistenceContext), {
    code: "SESSION_STORAGE_CORRUPT",
  });
});
