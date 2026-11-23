/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import { fork } from "node:child_process";
import { once } from "node:events";
import { test } from "node:test";
import { readFile, readdir, stat } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import { filePath as path } from "@noobot/path-resolver";
import { PARTITION_JOURNAL_PUBLICATION_LOCK } from "@noobot/session-protocol/partition-journal";
import { journalDirectoryPath } from "../../src/session/partition-storage/journal-directory.js";
import { PartitionJournal } from "../../src/session/partition-storage/partition-journal.js";
import { PartitionTransactions } from "../../src/session/partition-storage/partition-transactions.js";
import {
  commitFixtureTransaction,
  createJournalCase,
  createTransactionCase,
  journalTestLimits,
} from "../helpers/partition-journal-cases.js";

const childSource = `
  import { PartitionJournal } from ${JSON.stringify(new URL("../../src/session/partition-storage/partition-journal.js", import.meta.url).href)};
  import { PartitionTransactions } from ${JSON.stringify(new URL("../../src/session/partition-storage/partition-transactions.js", import.meta.url).href)};
  import { getFsAdapter, setFsAdapter } from ${JSON.stringify(new URL("../../src/shared/storage/fs-adapter.js", import.meta.url).href)};
  import { basename } from "node:path";
  const journal = await PartitionJournal.open(JSON.parse(process.argv[1]));
  process.send({ ready: true });
  process.once("message", async ({ request, prepared, project, pause, observeLock, exitBeforeRename, snapshot }) => {
    try {
      const adapter = getFsAdapter();
      let lockFd;
      if (pause || observeLock || exitBeforeRename) setFsAdapter({ ...adapter,
        async open(file, ...args) {
          const handle = await adapter.open(file, ...args);
          if (file === journal.lockPath) {
            lockFd = handle.fd;
            if (observeLock) process.send({ at: "lock", lockFd });
          }
          return handle;
        },
        async rename(source, target) {
          if (basename(target) === exitBeforeRename) process.exit(44);
          if (!pause || basename(target) !== "CURRENT") return adapter.rename(source, target);
          if (pause === "after") await adapter.rename(source, target);
          await new Promise(() => {
            process.once("disconnect", () => process.exit(1));
            process.channel.ref();
            process.send({ at: pause, lockFd });
          });
        },
      });
      let result;
      if (snapshot) result = await journal.snapshot();
      else if (project) result = await new PartitionTransactions(journal).projectLatestUpdates();
      else if (journal.head.publication === "collections")
        result = await new PartitionTransactions(journal).commit(request, {
            validateScope: () => {},
            prepare: () => {
              if (prepared === null) throw new Error("Replay must not prepare the transaction");
              return prepared;
            },
          });
      else result = await journal.append(request);
      await journal.close();
      process.send({ result }, () => process.disconnect());
    } catch (error) {
      process.send({ failure: { code: error.code, message: error.message } }, () => process.disconnect());
    }
  });
`;

async function createWriter(t, options) {
  const child = fork("--eval", [childSource, JSON.stringify(options)], {
    execArgv: [
      "--import",
      new URL("../../../shared/testing/runtime-params.js", import.meta.url).href,
      "--input-type=module",
    ],
    stdio: ["ignore", "ignore", "pipe", "ipc"],
  });
  t.after(() => {
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
  });
  let stderr = "";
  child.stderr.on("data", (data) => {
    stderr += data;
  });
  const exit = once(child, "exit");
  const first = await Promise.race([
    once(child, "message").then(([message]) => message),
    exit.then(([code]) => {
      throw new Error(`Writer exited before ready (${code}): ${stderr}`);
    }),
  ]);
  assert.deepEqual(first, { ready: true });
  function receive() {
    return Promise.race([
      once(child, "message").then(([message]) => message),
      exit.then(([code]) => {
        throw new Error(`Writer exited without an outcome (${code}): ${stderr}`);
      }),
    ]);
  }
  async function run(input) {
    const outcome = receive();
    child.send(input);
    const message = await outcome;
    const [code] = await exit;
    assert.equal(code, 0, stderr);
    return message;
  }
  return {
    child,
    exit,
    receive,
    append(request, prepared = null) {
      return run({ request, prepared });
    },
    project() {
      return run({ project: true });
    },
  };
}

const bootstrapSource = `
  import { PartitionJournal } from ${JSON.stringify(new URL("../../src/session/partition-storage/partition-journal.js", import.meta.url).href)};
  import { getFsAdapter, setFsAdapter } from ${JSON.stringify(new URL("../../src/shared/storage/fs-adapter.js", import.meta.url).href)};
  const { exitAt, ...options } = JSON.parse(process.argv[1]);
  if (exitAt) {
    const adapter = getFsAdapter();
    setFsAdapter({ ...adapter, async link(source, target) {
      if (exitAt === "before-link") process.exit(42);
      await adapter.link(source, target);
      process.exit(43);
    } });
  }
  process.send({ ready: true });
  process.once("message", async () => {
    let outcome;
    try {
      const journal = await PartitionJournal.create(options);
      outcome = { head: journal.head };
      await journal.close();
    } catch (error) {
      outcome = { code: error.code, message: error.message };
    }
    process.send(outcome, () => process.disconnect());
  });
`;

async function bootstrapProcess(t, options) {
  const child = fork("--eval", [bootstrapSource, JSON.stringify(options)], {
    execArgv: [
      "--import",
      new URL("../../../shared/testing/runtime-params.js", import.meta.url).href,
      "--input-type=module",
    ],
    stdio: ["ignore", "ignore", "inherit", "ipc"],
  });
  t.after(() => {
    if (child.exitCode === null && child.signalCode === null) child.kill();
  });
  const exit = once(child, "exit");
  const ready = await Promise.race([once(child, "message").then(([message]) => message), exit]);
  assert.deepEqual(ready, { ready: true });
  let outcome;
  child.once("message", (message) => {
    outcome = message;
  });
  return async () => {
    child.send({ start: true });
    const [code, signal] = await exit;
    return { code, signal, outcome };
  };
}

test(
  "independent processes retry abandoned bootstrap and install CURRENT only once",
  { timeout: 15000 },
  async (t) => {
    const { root: durableAncestor } = await createJournalCase(t);
    const root = path.join(durableAncestor, "bootstrap-process");
    const options = { root, durableAncestor, limits: journalTestLimits(), publication: "journal" };
    const abandon = await bootstrapProcess(t, {
      ...options,
      sessionId: "abandoned",
      exitAt: "before-link",
    });
    assert.deepEqual(await abandon(), { code: 42, signal: null, outcome: undefined });
    const entries = (await readdir(root)).sort();
    assert.equal(entries.length, 2);
    assert.equal(entries[0], "CURRENT.publish.tmp");
    assert.equal(entries[1], PARTITION_JOURNAL_PUBLICATION_LOCK);
    const lockPath = path.join(root, PARTITION_JOURNAL_PUBLICATION_LOCK);
    const initialLock = await stat(lockPath);

    const publishers = await Promise.all(
      ["first", "second"].map((sessionId) => bootstrapProcess(t, { ...options, sessionId })),
    );
    const results = await Promise.all(publishers.map((publish) => publish()));
    assert.deepEqual(
      results.map(({ code }) => code),
      [0, 0],
    );
    const winner = results.find(({ outcome }) => outcome?.head)?.outcome.head;
    assert.ok(winner, JSON.stringify(results));
    assert.equal(results.find(({ outcome }) => outcome?.code)?.outcome.code, "EEXIST");
    const reopened = await PartitionJournal.open({ root, sessionId: winner.sessionId });
    t.after(() => reopened.close());
    assert.deepEqual(reopened.head, winner);
    assert.deepEqual((await readdir(root)).sort(), ["CURRENT", PARTITION_JOURNAL_PUBLICATION_LOCK]);
    assert.equal((await stat(lockPath)).ino, initialLock.ino);
  },
);

test(
  "independent processes cannot replace CURRENT after its installer exits before syncing the root",
  { timeout: 15000 },
  async (t) => {
    const { root: durableAncestor } = await createJournalCase(t);
    const root = path.join(durableAncestor, "linked-bootstrap");
    const options = { root, durableAncestor, limits: journalTestLimits(), publication: "journal" };
    const sessionId = "installed";
    const install = await bootstrapProcess(t, { ...options, sessionId, exitAt: "after-link" });
    assert.deepEqual(await install(), { code: 43, signal: null, outcome: undefined });
    const entries = (await readdir(root)).sort();
    assert.equal(entries.length, 3);
    assert.equal(entries[0], "CURRENT");
    assert.equal(entries[1], "CURRENT.publish.tmp");
    assert.equal(entries[2], PARTITION_JOURNAL_PUBLICATION_LOCK);

    const retry = await bootstrapProcess(t, { ...options, sessionId: "replacement" });
    const { code, outcome } = await retry();
    assert.equal(code, 0);
    assert.equal(outcome.code, "EEXIST");
    const writer = await createWriter(t, { root, sessionId });
    const journal = await PartitionJournal.open({ root, sessionId });
    t.after(() => journal.close());
    assert.equal(journal.head.sequence, 0);
    assert.deepEqual((await readdir(root)).sort(), ["CURRENT", PARTITION_JOURNAL_PUBLICATION_LOCK]);
    const request = { epoch: journal.head.epoch, sequence: 1, payload: { recovered: true } };
    const { result } = await writer.append(request);
    assert.equal(result.replayed, false);
    const snapshot = await journal.snapshot();
    assert.equal(snapshot.sequence, 1);
    const page = await journal.readSequencePage({ snapshot, sequence: 1 });
    assert.deepEqual(
      page.records.map((record) => record.request),
      [request],
    );
  },
);

test("reopen discards an interrupted START publication and preserves the committed partition", async (t) => {
  const { journal, root, sessionId } = await createJournalCase(t, { partitionRecords: 1 });
  const first = { epoch: journal.head.epoch, sequence: 1, payload: { value: 1 } };
  const second = { epoch: journal.head.epoch, sequence: 2, payload: { value: 2 } };
  await journal.append(first);
  const writer = await createWriter(t, { root, sessionId });
  writer.child.send({ request: second, exitBeforeRename: "START" });
  assert.deepEqual(await writer.exit, [44, null]);
  const directory = path.dirname(journalDirectoryPath(root, 0));
  assert.ok((await readdir(directory)).includes("START.publish.tmp"));

  const reopened = await PartitionJournal.open({ root, sessionId });
  t.after(() => reopened.close());
  assert.equal(reopened.head.sequence, 1);
  assert.ok(!(await readdir(directory)).includes("START.publish.tmp"));
  await reopened.usingSnapshot(async (snapshot) => {
    const page = await reopened.readSequencePage({ snapshot, sequence: 1 });
    assert.deepEqual(
      page.records.map((record) => record.request),
      [first],
    );
  });
  assert.equal((await reopened.append(second)).replayed, false);
});

test("reopen discards an interrupted retention stage without releasing a published snapshot", async (t) => {
  const { journal, root, sessionId } = await createJournalCase(t, { retentionRecords: 2 });
  await journal.usingSnapshot(async () => {
    const directory = path.join(root, "retentions");
    const published = await readFile(path.join(directory, "0.json"));
    const writer = await createWriter(t, { root, sessionId });
    writer.child.send({ snapshot: true, exitBeforeRename: "1.json" });
    assert.deepEqual(await writer.exit, [44, null]);
    assert.deepEqual((await readdir(directory)).sort(), ["0.json", "1.json.publish.tmp"]);

    const reopened = await PartitionJournal.open({ root, sessionId });
    t.after(() => reopened.close());
    assert.deepEqual(await readdir(directory), ["0.json"]);
    assert.deepEqual(await readFile(path.join(directory, "0.json")), published);
    await reopened.usingSnapshot(async () => {
      assert.deepEqual((await readdir(directory)).sort(), ["0.json", "1.json"]);
    });
  });
});

async function assertLinuxStopped(pid, signal) {
  const deadline = performance.now() + 2000;
  let stopped;
  do {
    const status = await readFile(`/proc/${pid}/status`, "utf8");
    stopped = /^State:\s+T\b/m.test(status);
    if (stopped) return;
    await delay(10, undefined, { signal });
  } while (performance.now() < deadline);
  assert.fail(`Publisher ${pid} did not enter the Linux stopped state`);
}

async function assertLinuxLockDescriptor(pid, fd, lock) {
  assert.ok(Number.isInteger(fd) && fd >= 0);
  const descriptor = await stat(`/proc/${pid}/fd/${fd}`);
  assert.deepEqual([descriptor.dev, descriptor.ino], [lock.dev, lock.ino]);
}

for (const pause of ["before", "after"]) {
  test(
    `stopped publisher ${pause} CURRENT rename retains the lock until process death`,
    {
      skip: process.platform === "win32",
      timeout: 15000,
    },
    async (t) => {
      const { journal, root, sessionId } = await createJournalCase(t);
      const options = { root, sessionId };
      const [publisher, retry] = await Promise.all([
        createWriter(t, options),
        createWriter(t, options),
      ]);
      const request = { epoch: journal.head.epoch, sequence: 1, payload: { committedOnce: true } };
      const paused = publisher.receive();
      publisher.child.send({ request, pause });
      const publisherLock = await paused;
      assert.equal(publisherLock.at, pause);
      assert.equal(publisher.child.kill("SIGSTOP"), true);

      const current = path.join(root, "CURRENT");
      const head = await readFile(current);
      const lock = await stat(journal.lockPath);
      if (process.platform === "linux") {
        await assertLinuxStopped(publisher.child.pid, t.signal);
        await assertLinuxLockDescriptor(publisher.child.pid, publisherLock.lockFd, lock);
      }
      const attempting = retry.receive();
      retry.child.send({ request, observeLock: true });
      const retryLock = await attempting;
      assert.equal(retryLock.at, "lock");
      const outcome = retry.receive();
      if (process.platform === "linux") {
        await assertLinuxLockDescriptor(retry.child.pid, retryLock.lockFd, lock);
      }
      assert.equal(
        await Promise.race([outcome, delay(120, "waiting", { signal: t.signal })]),
        "waiting",
      );
      assert.deepEqual(await readFile(current), head);

      assert.equal(publisher.child.kill("SIGKILL"), true);
      assert.deepEqual(await publisher.exit, [null, "SIGKILL"]);
      const { result, failure } = await outcome;
      assert.equal(failure, undefined, JSON.stringify(failure));
      assert.equal(result.replayed, pause === "after");
      assert.deepEqual(await retry.exit, [0, null]);

      const reopened = await PartitionJournal.open(options);
      t.after(() => reopened.close());
      await reopened.usingSnapshot(async (snapshot) => {
        assert.equal(snapshot.sequence, 1);
        const page = await reopened.readSequencePage({ snapshot, sequence: 1 });
        assert.deepEqual(
          page.records.map((record) => record.request),
          [request],
        );
      });
      assert.equal((await stat(journal.lockPath)).ino, lock.ino);
    },
  );
}

test(
  "independent processes publish one transaction for concurrent identical retries",
  { timeout: 15000 },
  async (t) => {
    const { journal, root, sessionId } = await createJournalCase(t);
    const writers = await Promise.all([
      createWriter(t, { root, sessionId }),
      createWriter(t, { root, sessionId }),
    ]);
    const request = {
      epoch: journal.head.epoch,
      sequence: 1,
      payload: { delta: "one authoritative result" },
    };
    const outcomes = await Promise.all(writers.map((writer) => writer.append(request)));
    assert.ok(
      outcomes.every((outcome) => outcome.result),
      JSON.stringify(outcomes),
    );
    assert.deepEqual(outcomes.map(({ result }) => result.replayed).sort(), [false, true]);
    const snapshot = await journal.snapshot();
    assert.equal(snapshot.sequence, 1);
    const page = await journal.readSequencePage({ snapshot, sequence: 1 });
    assert.deepEqual(
      page.records.map(({ request: stored }) => stored),
      [request],
    );
  },
);

test(
  "a new process replays the exact durable session commit outcome without preparing again",
  { timeout: 15000 },
  async (t) => {
    const { journal, root, sessionId } = await createTransactionCase(t);
    const options = { root, sessionId };
    const transactions = new PartitionTransactions(journal);
    const message = { messageUid: "m", content: "hello" };
    const request = await journal.usingSnapshot((snapshot) =>
      transactions.prepareRequest(snapshot, {
        operationId: "message-create",
        changes: { messages: [message] },
        committedAt: "2026-11-19T00:00:00.000Z",
      }),
    );
    const writer = await createWriter(t, options);
    const first = await writer.append(request, {
      action: "commit",
      mutations: [{ collection: "messages", key: "m", owner: null, value: message }],
      result: { messageUid: "m", contentVersion: 1 },
    });
    assert.ok(first.result, JSON.stringify(first.failure));
    assert.equal(first.result.replayed, false);

    const current = path.join(root, "CURRENT");
    const before = await stat(current, { bigint: true });
    const restarted = await createWriter(t, options);
    assert.deepEqual(await restarted.append(request), {
      result: { ...first.result, replayed: true },
    });
    const after = await stat(current, { bigint: true });
    assert.equal(after.ino, before.ino, "replay must not replace CURRENT");
    assert.equal(after.mtimeNs, before.mtimeNs, "replay must not rewrite CURRENT");
    await journal.usingSnapshot((snapshot) => assert.equal(snapshot.sequence, 1));
  },
);

test(
  "a commit without mutations survives a process restart and a partition seal",
  { timeout: 15000 },
  async (t) => {
    const { journal, root, sessionId } = await createTransactionCase(t, { partitionRecords: 1 });
    const options = { root, sessionId };
    const request = {
      epoch: journal.head.epoch,
      expectedGeneration: 0,
      operationId: "receipt-only",
      input: { messageUid: "m" },
    };
    const result = { outcome: "already-current" };
    const first = await (
      await createWriter(t, options)
    ).append(request, {
      action: "commit",
      mutations: [],
      result,
    });
    assert.ok(first.result?.reference, JSON.stringify(first.failure));
    assert.equal(first.result.generation, 1);
    assert.equal(first.result.replayed, false);
    assert.deepEqual(first.result.result, result);
    assert.deepEqual(first.result.mutations, []);
    const transactions = new PartitionTransactions(journal);
    const next = await commitFixtureTransaction(transactions, {
      ...request,
      sequence: 2,
      expectedGeneration: 1,
      operationId: "next-message",
      mutations: [{ collection: "messages", key: "m", owner: null, value: "next" }],
      result: null,
    });
    assert.equal(next.reference.partition, first.result.reference.partition + 1);
    assert.deepEqual(await (await createWriter(t, options)).append(request), {
      result: { ...first.result, replayed: true },
    });
    const snapshot = await journal.snapshot();
    assert.equal(snapshot.sequence, 2);
    await journal.releaseSnapshot(snapshot);
  },
);

test(
  "independent processes reject conflicting content at the same sequence",
  { timeout: 15000 },
  async (t) => {
    const { journal, root, sessionId } = await createJournalCase(t);
    const writers = await Promise.all([
      createWriter(t, { root, sessionId }),
      createWriter(t, { root, sessionId }),
    ]);
    const outcomes = await Promise.all(
      writers.map((writer, index) =>
        writer.append({ epoch: journal.head.epoch, sequence: 1, payload: { writer: index } }),
      ),
    );
    assert.equal(outcomes.filter((outcome) => outcome.result).length, 1);
    assert.deepEqual(
      outcomes.find((outcome) => outcome.failure)?.failure.code,
      "SESSION_OPERATION_CONFLICT",
    );
    assert.equal((await journal.snapshot()).sequence, 1);
  },
);

test(
  "contending processes publish a deferred entity projection once and preserve the retained view",
  { timeout: 15000 },
  async (t) => {
    const { journal, root, sessionId } = await createTransactionCase(t);
    const transactions = new PartitionTransactions(journal);
    const commit = (sequence, owner) =>
      commitFixtureTransaction(transactions, {
        epoch: journal.head.epoch,
        sequence,
        expectedGeneration: sequence - 1,
        operationId: `message-${sequence}`,
        input: { value: sequence },
        mutations: [{ collection: "messages", key: "m", owner, value: sequence }],
        result: sequence,
      });
    const creation = await commit(1, null);
    const { owner } = creation.mutations[0];
    await commit(2, owner);

    const writers = await Promise.all([
      createWriter(t, { root, sessionId }),
      createWriter(t, { root, sessionId }),
    ]);
    const read = async (snapshot) =>
      (await transactions.getLatestMany({ snapshot, collection: "messages", keys: ["m"] })).get(
        "m",
      );
    await journal.usingSnapshot(async (retained) => {
      assert.notEqual(retained.deferredEntityUpdates, null);
      assert.equal(retained.entityDirectory.latestUpdates, null);
      const outcomes = await Promise.all(writers.map((writer) => writer.project()));
      const results = outcomes.map(({ failure, result }) => {
        assert.equal(failure, undefined, JSON.stringify(failure));
        return result;
      });
      assert.deepEqual(results.map(({ projected }) => projected).sort(), [false, true]);
      assert.ok(results.every(({ sequence }) => sequence === 2));
      await journal.usingSnapshot(async (published) => {
        assert.equal(published.sequence, 2);
        assert.equal(published.deferredEntityUpdates, null);
        assert.notEqual(published.entityDirectory.latestUpdates, null);
        assert.deepEqual(await read(published), await read(retained));
      });

      await commit(3, owner);
      await journal.usingSnapshot(async (latest) => {
        assert.equal((await read(latest)).value, 3);
        assert.equal((await read(retained)).value, 2);
      });
    });
  },
);
