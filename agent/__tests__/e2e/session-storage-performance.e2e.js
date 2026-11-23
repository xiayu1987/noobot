/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { readdir, stat } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import { createResourceRef, filePath as path } from "@noobot/path-resolver";
import { repositoryMessage as message, timestamp } from "../helpers/session-repository-message.js";
import { observeSessionStorageWork } from "../../src/session/session-storage-observation.js";
import { observeStorageIo } from "../helpers/storage-io-observation.js";
import { partitionRepositoryPerformanceFixture } from "../helpers/partition-repository-performance-fixture.js";
import { PartitionJournal } from "../../src/session/partition-storage/partition-journal.js";
import {
  partitionCommitPhase,
  partitionEntityPageWrite,
} from "../../src/session/partition-storage/partition-commit-observation.js";
import { PARTITION_MESSAGE_PAGE } from "@noobot/session-protocol/partition-session-messages";
import {
  nextSessionMessagePageCursor,
  requireSessionMessagePagePosition,
} from "@noobot/session-protocol/message-read-budget";
import {
  createMessageCase,
  openTestMessages,
  prepare as preparePartition,
} from "../session/partition-session-messages.test-helpers.js";

import { canonicalToolTimelineItem } from "../session/session-repository-boundary.summaries.fixtures.js";

const sampleCount = 16;
const seedBatch = 32;

const workGrowthFactor = 1.25;
const workGrowthAllowance = 16 * 1024;
const spaceEnvelopeFactor = 8;
const spaceEnvelopeAllowance = 16 * 1024 * 1024;

async function observeCommitPhases(root, operation) {
  const phases = {};
  const entityPageWrites = Object.create(null);
  const countPageWrite = ({ root, bytes }) => {
    entityPageWrites[root] = (entityPageWrites[root] ?? 0) + bytes;
  };
  const measured = await observeStorageIo(root, async (readBytes, writeBytes) => {
    const starts = new WeakMap();
    const collect = ({ event, phase, token, elapsedMs }) => {
      if (event === "start") {
        starts.set(token, { read: readBytes(), write: writeBytes() });
        return;
      }
      const start = starts.get(token);
      const sample = (phases[phase] ??= { count: 0, totalMs: 0, readBytes: 0, writeBytes: 0 });
      sample.count += 1;
      sample.totalMs += elapsedMs;
      sample.readBytes += readBytes() - start.read;
      sample.writeBytes += writeBytes() - start.write;
    };
    partitionCommitPhase.subscribe(collect);
    partitionEntityPageWrite.subscribe(countPageWrite);
    try {
      return await operation();
    } finally {
      partitionCommitPhase.unsubscribe(collect);
      partitionEntityPageWrite.unsubscribe(countPageWrite);
    }
  });
  return { ...measured, phases, entityPageWrites };
}

async function assertAcceptance(t, samples, logicalBytes) {
  const first = samples[0];
  for (const metric of [
    "writeBytesPerTransaction",
    "readBytesPerTransaction",
    "pageReadBytes",
    "appendWriteBytesPerTransaction",
    "appendReadBytesPerTransaction",
  ]) {
    await t.test(`${metric} stays within the fixed-work envelope`, () => {
      const maximum = first[metric] * workGrowthFactor + workGrowthAllowance;
      for (const sample of samples)
        assert.ok(
          sample[metric] <= maximum,
          JSON.stringify({ metric, history: sample.history, actual: sample[metric], maximum }),
        );
    });
  }
  await t.test("retained session bytes stay within the dataset envelope", () => {
    const { disk } = samples.at(-1);
    const actual = disk.bytes;
    const maximum = logicalBytes * spaceEnvelopeFactor + spaceEnvelopeAllowance;
    assert.ok(actual <= maximum, JSON.stringify({ actual, maximum, logicalBytes, disk }));
  });
}

async function usage(directory, summarize = true) {
  let bytes = 0;
  let files = 0;
  const byEntry = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    const nested = entry.isDirectory()
      ? await usage(file, false)
      : { bytes: (await stat(file)).size, files: 1 };
    bytes += nested.bytes;
    files += nested.files;
    if (summarize) byEntry.push([entry.name, nested]);
  }
  return summarize ? { bytes, files, byEntry: Object.fromEntries(byEntry) } : { bytes, files };
}

for (const mode of ["long-turn", "many-turns"]) {
  test(`partition session repository performance acceptance: ${mode}`, async (t) => {
    const fixture = await partitionRepositoryPerformanceFixture(t);
    const { scope, commit, reopen } = fixture;
    const openReader = () => {
      const { repository, persistenceContext } = fixture.services;
      return repository.requireSessionReader("u1", "s1", { persistenceContext });
    };
    let sequence = 0;
    let logicalBytes = 0;
    const samples = [];
    for (const history of [10, 1000, 10000]) {
      const { work: seedWork } = await observeSessionStorageWork(async () => {
        while (sequence < history) {
          const records = [];
          while (records.length < seedBatch && sequence < history) {
            const record = message(mode, ++sequence);
            logicalBytes += Buffer.byteLength(JSON.stringify(record));
            records.push(record);
          }
          await commit({ messages: records });
        }
      });
      const latencies = [];
      const diskBefore = await usage(scope.sessionDir);
      const {
        result: measured,
        work: commitIo,
        phases: creationPhases,
        entityPageWrites: creationEntityPageWrites,
      } = await observeCommitPhases(scope.sessionDir, () =>
        observeSessionStorageWork(async () => {
          let receipt;
          for (let sample = 0; sample < sampleCount; sample += 1) {
            const record = message(mode, ++sequence);
            logicalBytes += Buffer.byteLength(JSON.stringify(record));
            const started = performance.now();
            receipt = await commit({ messages: [record] });
            latencies.push(performance.now() - started);
            assert.equal(receipt.result.messageReceipts[0].messageUid, record.messageUid);
          }
          return receipt;
        }),
      );
      const current = message(mode, sequence);
      const { result: reopened, work: reopenedIo } = await observeStorageIo(scope.sessionDir, () =>
        observeSessionStorageWork(async () => {
          await reopen();
          await using reader = await openReader();
          const page = await reader.readTurnPage({
            turnScopeId: current.turnScopeId,
            after: mode === "long-turn" ? sequence - 1 : 0,
            limit: 1,
          });
          assert.equal(page.records.length, 1);
          assert.equal(page.records[0].message.messageUid, current.messageUid);
          assert.equal(page.records[0].message.content, current.content);
          assert.equal(reader.generation, measured.result.generation);
        }),
      );
      const { messageUid, dialogProcessId, turnScopeId } = current;
      const [{ owner }] = measured.result.result.messageReceipts;
      let [{ contentReference }] = measured.result.result.messageReceipts;
      const chunk = '"🙂'.repeat(32);
      const {
        result: { work: appendWork },
        work: appendIo,
        phases: appendPhases,
        entityPageWrites: appendEntityPageWrites,
      } = await observeCommitPhases(scope.sessionDir, () =>
        observeSessionStorageWork(async () => {
          for (let sample = 0; sample < sampleCount; sample += 1) {
            const append = {
              messageUid,
              dialogProcessId,
              turnScopeId,
              owner,
              expectedContentReference: contentReference,
              content: chunk,
            };
            const outcome = await commit({ messageContentAppends: [append] });
            const [receipt] = outcome.result.messageReceipts;
            assert.equal(receipt.messageUid, messageUid);
            assert.notEqual(receipt.contentReference, contentReference);
            contentReference = receipt.contentReference;
            logicalBytes += Buffer.byteLength(chunk);
          }
        }),
      );
      await using reader = await openReader();
      const page = await reader.readTurnPage({
        turnScopeId,
        after: mode === "long-turn" ? sequence - 1 : 0,
        limit: 1,
      });
      assert.equal(page.records[0].message.content, current.content + chunk.repeat(sampleCount));
      const diskAfter = await usage(scope.sessionDir);
      latencies.sort((left, right) => left - right);
      samples.push({
        history,
        writeBytesPerTransaction: commitIo.writeBytes / sampleCount,
        readBytesPerTransaction: commitIo.readBytes / sampleCount,
        pageReadBytes: reopenedIo.readBytes,
        appendWriteBytesPerTransaction: appendIo.writeBytes / sampleCount,
        appendReadBytesPerTransaction: appendIo.readBytes / sampleCount,
        disk: diskAfter,
      });
      t.diagnostic(
        JSON.stringify(
          {
            benchmark: "session-repository-acceptance",
            backend: "partition",
            mode,
            historyMessages: history,
            measuredTransactions: sampleCount,
            p50Ms: Number(latencies[Math.floor(sampleCount * 0.5)].toFixed(3)),
            sampleMaxMs: Number(latencies.at(-1).toFixed(3)),
            diskGrowthBytesPerTransaction: (diskAfter.bytes - diskBefore.bytes) / (2 * sampleCount),
            disk: diskAfter,
            logicalMessageBytes: logicalBytes,
            creation: {
              io: commitIo,
              phases: creationPhases,
              entityPageWrites: creationEntityPageWrites,
            },
            append: {
              io: appendIo,
              phases: appendPhases,
              entityPageWrites: appendEntityPageWrites,
            },
            seedWork,
            appendWork,
            reopenedIo,
            commitWork: measured.work,
            reopenedPageWork: reopened.work,
          },
          (_key, value) => (value instanceof Map ? Object.fromEntries(value) : value),
        ),
      );
    }
    await assertAcceptance(t, samples, logicalBytes);
  });
}

for (const mode of ["long-turn", "many-turns"]) {
  test(`partition session detail first page stays within the fixed-work envelope: ${mode}`, async (t) => {
    const fixture = await partitionRepositoryPerformanceFixture(t);
    const request = {
      sessionId: "s1",
      cursor: null,
      direction: "backward",
      limit: 1,
      maxBytes: 4096,
      terminalLimit: 1,
      reconcileTurnScopeIds: [],
    };
    let sequence = 0;
    let receipt;
    const samples = [];
    for (const history of [10, 1000, 10000]) {
      while (sequence < history) {
        const messages = Array.from({ length: Math.min(seedBatch, history - sequence) }, () =>
          message(mode, ++sequence),
        );
        receipt = await fixture.commit({ messages });
      }
      const { result: first, work } = await observeStorageIo(fixture.scope.sessionDir, async () => {
        await fixture.reopen();
        return fixture.services.session.getSessionDetailStart({ userId: "u1", request });
      });
      assert.equal(first.generation, receipt.generation);
      assert.equal(first.stats.messageCount, history);
      assert.equal(first.stats.displayMessageCount, history);
      assert.deepEqual(
        first.messages.map(({ messageUid }) => messageUid),
        [`m${history}`],
      );
      assert.ok(first.nextCursor);
      assert.ok(work.readBytes > 0);
      const {
        terminalLimit: _terminal,
        reconcileTurnScopeIds: _reconcile,
        ...pageRequest
      } = request;
      const { session } = fixture.services;
      const next = await session.getSessionDisplayPage({
        userId: "u1",
        request: { ...pageRequest, cursor: first.nextCursor },
      });
      assert.equal(next.generation, first.generation);
      assert.equal(next.aggregateVersion, first.aggregateVersion);
      assert.deepEqual(next.stats, first.stats);
      assert.deepEqual(
        next.messages.map(({ messageUid }) => messageUid),
        [`m${history - 1}`],
      );
      assert.deepEqual(
        await session.releaseSessionDisplayPage({
          userId: "u1",
          request: { sessionId: request.sessionId, cursor: next.nextCursor },
        }),
        { released: true },
      );
      const sample = { history, readBytes: work.readBytes, readCalls: work.readCalls };
      samples.push(sample);
      t.diagnostic(JSON.stringify({ mode, ...sample }));
    }
    const maximum = samples[0].readBytes * workGrowthFactor + workGrowthAllowance;
    for (const sample of samples) {
      assert.ok(sample.readBytes <= maximum, JSON.stringify({ maximum, ...sample }));
    }
  });
}

for (const mode of ["long-turn", "many-turns"]) {
  test(`partition message repository performance acceptance: ${mode}`, async (t) => {
    const { journal, root, sessionId } = await createMessageCase(t, {
      partitionBytes: 512 * 1024,
      transactionBytes: 128 * 1024,
      queueBytes: 512 * 1024,
      batchBytes: 128 * 1024,
      receiptBytes: 128 * 1024,
      entityProjectionBytes: 512 * 1024,
      pageBytes: 128 * 1024,
      pageRecords: seedBatch,
      quotaBytes: 256 * 1024 * 1024,
    });
    const repository = openTestMessages(journal, sessionId);
    let operation = 0;
    const commit = async (changes) =>
      repository.commit(
        await preparePartition(journal, repository, `performance-${++operation}`, changes),
      );
    let sequence = 0;
    let logicalBytes = 0;
    const samples = [];
    const nextMessage = () => {
      const record = message(mode, ++sequence, sessionId);
      logicalBytes += Buffer.byteLength(JSON.stringify(record));
      return record;
    };
    for (const history of [10, 1000, 10000]) {
      while (sequence < history) {
        const records = Array.from(
          { length: Math.min(seedBatch, history - sequence) },
          nextMessage,
        );
        await commit({ messages: records });
      }
      const { result: receipt, work: createIo } = await observeStorageIo(root, async () => {
        let receipt;
        for (let index = 0; index < sampleCount; index += 1) {
          const record = nextMessage();
          ({
            result: {
              messageReceipts: [receipt],
            },
          } = await commit({ messages: [record] }));
          assert.equal(receipt.messageUid, record.messageUid);
        }
        return receipt;
      });
      const current = message(mode, sequence, sessionId);
      const { dialogProcessId, turnScopeId, messageUid } = current;
      const after = mode === "long-turn" ? sequence - 1 : 0;
      const pageReads = {};
      const { work: pageIo } = await observeStorageIo(root, async (readBytes) => {
        const measurePage = async (stage, operation) => {
          const before = readBytes();
          const result = await operation();
          pageReads[stage] = readBytes() - before;
          return result;
        };
        const reopened = await PartitionJournal.open({ root, sessionId });
        try {
          const reader = openTestMessages(reopened, sessionId);
          await reopened.usingSnapshot(async (snapshot) => {
            const identity = { snapshot, dialogProcessId, turnScopeId };
            const scope = [
              sessionId,
              snapshot.epoch,
              snapshot.sequence,
              PARTITION_MESSAGE_PAGE.turn,
              dialogProcessId,
              turnScopeId,
            ];
            const position = requireSessionMessagePagePosition(scope, null);
            const page = await measurePage("turn", () =>
              reader.readTurnPage({
                ...identity,
                cursor: nextSessionMessagePageCursor(position, after, after > 0),
                limit: 1,
              }),
            );
            assert.equal(page.entries.length, 1);
            assert.equal(page.entries[0].message.messageUid, messageUid);
            assert.equal(page.entries[0].contentReference, receipt.contentReference);
            const content = await measurePage("content", () =>
              reader.readContentPage({
                ...identity,
                messageUid,
                contentReference: receipt.contentReference,
                cursor: null,
                limit: 1,
              }),
            );
            assert.deepEqual(content, { entries: [current.content], nextCursor: null });
          });
        } finally {
          await reopened.close();
        }
      });
      let { contentReference } = receipt;
      const chunk = '"🙂'.repeat(32);
      const { work: appendIo } = await observeStorageIo(root, async () => {
        for (let index = 0; index < sampleCount; index += 1) {
          const append = {
            messageUid,
            dialogProcessId,
            turnScopeId,
            owner: receipt.owner,
            expectedContentReference: contentReference,
            content: chunk,
          };
          const outcome = await commit({ messageContentAppends: [append] });
          const [next] = outcome.result.messageReceipts;
          assert.equal(next.messageUid, messageUid);
          assert.notEqual(next.contentReference, contentReference);
          contentReference = next.contentReference;
          logicalBytes += Buffer.byteLength(chunk);
        }
      });
      await journal.usingSnapshot(async (snapshot) => {
        let cursor = null;
        const chunks = [];
        do {
          const page = await repository.readContentPage({
            snapshot,
            dialogProcessId,
            turnScopeId,
            messageUid,
            contentReference,
            cursor,
            limit: 1,
          });
          chunks.push(...page.entries);
          cursor = page.nextCursor;
        } while (cursor !== null);
        assert.equal(chunks.join(""), current.content + chunk.repeat(sampleCount));
      });
      const sample = {
        history,
        writeBytesPerTransaction: createIo.writeBytes / sampleCount,
        readBytesPerTransaction: createIo.readBytes / sampleCount,
        pageReadBytes: pageIo.readBytes,
        pageReadStages: {
          snapshot: pageIo.readBytes - pageReads.turn - pageReads.content,
          turn: pageReads.turn,
          content: pageReads.content,
        },
        appendWriteBytesPerTransaction: appendIo.writeBytes / sampleCount,
        appendReadBytesPerTransaction: appendIo.readBytes / sampleCount,
        disk: await usage(root),
      };
      samples.push(sample);
      t.diagnostic(JSON.stringify({ mode, ...sample }));
    }
    await assertAcceptance(t, samples, logicalBytes);
  });
}

test("partition session repository bounds fixed-size tool updates within a long turn", async (t) => {
  const fixture = await partitionRepositoryPerformanceFixture(t);
  const { scope, commit } = fixture;
  const presentationMessageId = "answer";
  const question = message("long-turn", 0);
  await commit({ messages: [question] });
  const toolMessage = (index) => {
    const { userMessageId: _user, messageOrigin: _origin, ...base } = message("long-turn", index);
    const toolCallId = `tool-${String(index).padStart(4, "0")}`;
    return {
      ...base,
      role: "assistant",
      type: "tool_call",
      chatPresentation: false,
      presentationMessageId,
      modelMessageId: `model-${index}`,
      content: "",
      tool_calls: [
        { id: toolCallId, type: "function", function: { name: "read_file", arguments: "{}" } },
      ],
      toolTimeline: [
        canonicalToolTimelineItem({
          toolCallId,
          tool: "read_file",
          args: {},
          call: {
            eventId: toolCallId,
            sequence: index + 1,
            sequenceScopeId: base.messageUid,
            sequenceDomain: "message-event",
            authority: "authoritative",
            timestamp,
            sessionId: base.sessionId,
            dialogProcessId: base.dialogProcessId,
            turnScopeId: base.turnScopeId,
          },
        }),
      ],
    };
  };
  const { tool_calls: _calls, toolTimeline: _timeline, ...assistant } = toolMessage(0);
  const answer = {
    ...assistant,
    messageUid: "answer-message",
    type: "message",
    chatPresentation: true,
    content: "answer",
  };
  await commit({ messages: [answer] });
  const { repository, persistenceContext } = fixture.services;
  const openReader = () => repository.requireSessionReader("u1", "s1", { persistenceContext });
  const selection = { cursor: null, direction: "forward", limit: 2, maxBytes: 128 * 1024 };
  await using retained = await openReader();
  const first = await retained.readDisplayPage({ ...selection, limit: 1 });
  assert.notEqual(first.nextCursor, null);
  const samples = [];
  let sequence = 0;
  const observeStage = async (stage, operation) => {
    const { result, work } = await observeStorageIo(scope.sessionDir, async (bytesRead) => {
      try {
        return await operation();
      } catch (cause) {
        throw new Error(`${stage} failed after reading ${bytesRead()} bytes`, { cause });
      }
    });
    const io = { readBytes: work.readBytes, writeBytes: work.writeBytes };
    t.diagnostic(JSON.stringify({ stage, ...io }));
    return { result, io };
  };
  for (const history of [10, 100, 300]) {
    while (sequence < history) {
      const from = sequence + 1;
      const records = Array.from({ length: Math.min(seedBatch, history - sequence) }, () =>
        toolMessage(++sequence),
      );
      await observeStage(`seed ${from}-${sequence}`, () => commit({ messages: records }));
    }
    const record = toolMessage(++sequence);
    const { io } = await observeStage(`update at ${history}`, () => commit({ messages: [record] }));
    samples.push({ history, ...io });
  }
  const { result: page } = await observeStage("display page", async () => {
    await using reader = await openReader();
    await assert.rejects(reader.readDisplayPage({ ...selection, cursor: first.nextCursor }), {
      code: "SESSION_PAGE_CURSOR_CONFLICT",
    });
    const display = await reader.readDisplayPage(selection);
    const detailSelection = {
      lookupKey: { turnScopeId: question.turnScopeId, dialogProcessId: question.dialogProcessId },
      cursor: null,
      limit: 3,
      maxBytes: selection.maxBytes,
    };
    const detail = await reader.readThinkingDetailPage(detailSelection);
    assert.equal(detail.generation, display.generation);
    assert.ok(detail.nextCursor);
    assert.equal(detail.records[2].message.toolTimeline[0].toolCallId, "tool-0001");
    const nextDetail = await reader.readThinkingDetailPage({
      ...detailSelection,
      cursor: detail.nextCursor,
    });
    assert.equal(nextDetail.generation, display.generation);
    assert.equal(nextDetail.records[0].message.toolTimeline[0].toolCallId, "tool-0002");
    return display;
  });
  assert.deepEqual(
    page.messages.map(({ messageUid }) => messageUid),
    [question.messageUid, answer.messageUid],
  );
  assert.equal(page.stats.displayMessageCount, 2);
  assert.equal(page.stats.messageCount, 2 + sequence);
  assert.equal(page.messages[1].hasThinkingDetails, true);
  assert.equal(Object.hasOwn(page.messages[1], "toolTimeline"), false);
  const last = await retained.readDisplayPage({ ...selection, cursor: first.nextCursor });
  assert.equal(last.nextCursor, null);
  assert.deepEqual(last.stats, first.stats);
  assert.equal(last.stats.messageCount, 2);
  assert.equal(last.messages[0].messageUid, answer.messageUid);
  assert.notEqual(last.messages[0].hasThinkingDetails, true);
  for (const metric of ["readBytes", "writeBytes"]) {
    await t.test(metric, () => {
      const maximum = samples[0][metric] * workGrowthFactor + workGrowthAllowance;
      assert.ok(
        samples.every((sample) => sample[metric] <= maximum),
        JSON.stringify({ metric, maximum, samples }),
      );
    });
  }
});

test("partition session repository stays within the fixed-work envelope for artifact updates", async (t) => {
  const { scope, commit } = await partitionRepositoryPerformanceFixture(t);
  const { userMessageId: _user, messageOrigin: _origin, ...base } = message("long-turn", 0);
  const presentationMessageId = "artifact-answer";
  await commit({
    messages: [
      {
        ...base,
        role: "assistant",
        modelMessageId: "artifact-model",
        presentationMessageId,
        chatPresentation: true,
        content: "answer",
      },
    ],
  });
  const result = (index) => {
    const id = String(index).padStart(4, "0");
    const logical = { view: "workspace", path: `${id}.txt` };
    return {
      ...base,
      messageUid: `result-${id}`,
      presentationMessageId,
      role: "tool",
      type: "tool_result",
      tool_call_id: `call-${id}`,
      toolName: "read_file",
      content: JSON.stringify({ ok: true, path: logical }),
      resourceRefs: [
        createResourceRef({
          owner: "u1",
          source: "workspace",
          logical,
          mimeType: "text/plain",
          capabilities: { read: true, write: false },
        }),
      ],
    };
  };
  const samples = [];
  let count = 0;
  const commitResults = async (messages) => {
    try {
      return await commit({ messages });
    } catch (cause) {
      throw new Error(
        `Artifact commit failed for ${messages[0].messageUid} through ${messages.at(-1).messageUid}`,
        { cause },
      );
    }
  };
  for (const history of [10, 100, 300]) {
    while (count < history) {
      const batch = Array.from({ length: Math.min(seedBatch, history - count) }, () =>
        result(++count),
      );
      await commitResults(batch);
    }
    const { work, phases, entityPageWrites } = await observeCommitPhases(scope.sessionDir, () =>
      commitResults([result(++count)]),
    );
    assert.equal(Object.hasOwn(entityPageWrites, "undefined"), false);
    assert.equal(
      Object.values(entityPageWrites).reduce((total, bytes) => total + bytes, 0),
      [...work.writeBytesByPath]
        .filter(([file]) => file.endsWith(".pages"))
        .reduce((total, [, bytes]) => total + bytes, 0),
    );
    const sample = { history, readBytes: work.readBytes, writeBytes: work.writeBytes };
    samples.push(sample);
    t.diagnostic(
      JSON.stringify({ ...sample, io: work, phases, entityPageWrites }, (_key, value) =>
        value instanceof Map ? Object.fromEntries(value) : value,
      ),
    );
  }
  for (const metric of ["readBytes", "writeBytes"]) {
    await t.test(metric, () => {
      const maximum = samples[0][metric] * workGrowthFactor + workGrowthAllowance;
      assert.ok(
        samples.every((sample) => sample[metric] <= maximum),
        JSON.stringify({ metric, maximum, samples }),
      );
    });
  }
});
