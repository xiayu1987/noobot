/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import test from "node:test";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, utimes } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { SESSION_CALLER } from "@noobot/shared/session-caller";
import { createEmptyTurnLifecycle } from "@noobot/session-protocol";
import { initializeImmutableSession } from "../../src/session/session-artifact-session/immutable-session-bootstrap.js";
import { ImmutableSessionStore } from "../../src/session/session-artifact-session/immutable-session-store.js";
import { readImmutableOutboxPage } from "../../src/session/session-artifact-session/immutable-outbox.js";
import { auditImmutableSession } from "../../src/session/session-artifact-session/immutable-session-audit.js";

const ts = "2026-01-01T00:00:00.000Z";
const moduleUrl = (file) => new URL(file, import.meta.url).href;
const writerSource = `
  import { rename } from "node:fs/promises";
  import { writeSync } from "node:fs";
  import path from "node:path";
  import { commitSessionChanges } from ${JSON.stringify(moduleUrl("../../src/session/session-artifact-session/commit-session-changes.js"))};
  import { setFsAdapter } from ${JSON.stringify(moduleUrl("../../src/shared/storage/fs-adapter.js"))};
  const input = [];
  for await (const chunk of process.stdin) input.push(chunk);
  const { request, stage } = JSON.parse(Buffer.concat(input).toString("utf8"));
  const crash = () => {
    writeSync(1, "crash:" + stage);
    process.kill(process.pid, "SIGKILL");
  };
  setFsAdapter({ rename: async (source, target) => {
    const head = target === path.join(request.sessionDir, "head.json");
    if (head && stage === "before-head") crash();
    await rename(source, target);
    if (head && stage === "after-head") crash();
  }});
  const result = await commitSessionChanges(request);
  if (stage === "before-response") crash();
  process.stdout.write(JSON.stringify(result));
`;

function runWriter(t, request, stage = "") {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [
        "--import",
        moduleUrl("../../../shared/testing/runtime-params.js"),
        "--input-type=module",
        "--eval",
        writerSource,
      ],
      { stdio: ["pipe", "pipe", "pipe"], timeout: 10000, killSignal: "SIGKILL" },
    );
    t.after(() => {
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (chunk) => (stdout += chunk));
    child.stderr.setEncoding("utf8").on("data", (chunk) => (stderr += chunk));
    child.once("error", reject);
    child.stdin.once("error", reject);
    child.stdin.end(JSON.stringify({ request, stage }));
    child.once("close", (code, signal) => {
      if (stage && signal === "SIGKILL" && stdout === `crash:${stage}`) resolve({ signal });
      else if (code !== 0) reject(new Error(`Business writer exited ${code}/${signal}: ${stderr}`));
      else {
        try {
          resolve(JSON.parse(stdout));
        } catch (cause) {
          reject(new Error(`Invalid business writer response: ${stdout}`, { cause }));
        }
      }
    });
  });
}

async function fixture(t) {
  const sessionDir = await mkdtemp(path.join(tmpdir(), "immutable-business-crash-"));
  t.after(() => rm(sessionDir, { recursive: true, force: true }));
  await initializeImmutableSession({
    sessionDir,
    operationId: "initialize",
    session: {
      sessionId: "s1",
      parentSessionId: "",
      caller: SESSION_CALLER.USER,
      aggregateVersion: 0,
      messages: [],
      dialogOrder: [],
      turnTimings: [],
      sessionArtifactEvents: [],
      turnLifecycle: createEmptyTurnLifecycle(),
      createdAt: ts,
      updatedAt: ts,
    },
  });
  return ImmutableSessionStore.open({ sessionDir });
}

function requestFor(store, expectedGeneration) {
  return {
    sessionDir: store.sessionDir,
    sessionId: store.sessionId,
    expectedGeneration,
    operationId: "accept",
    committedAt: ts,
    changes: {
      messages: [
        {
          messageUid: "m1",
          userMessageId: "m1",
          sessionId: "s1",
          parentSessionId: "",
          dialogProcessId: "d1",
          parentDialogProcessId: "",
          turnScopeId: "t1",
          role: "user",
          messageOrigin: "natural",
          type: "message",
          content: "跨进程🙂".repeat(20000),
          attachments: [],
          transferEnvelopes: [],
          ts,
        },
      ],
      turnTransition: {
        eventType: "turn.action_accepted",
        phase: "action",
        action: "send",
        sessionId: "s1",
        turnScopeId: "t1",
        dialogProcessId: "d1",
        presentationMessageId: "p1",
        commandId: "accept",
        causationId: "accept",
        executionId: "agent:t1",
        executionKind: "agent",
        rootExecutionId: "agent:t1",
      },
      sessionMetadata: { customTitle: "crash recovery" },
      timings: [{ turnScopeId: "t1", dialogProcessId: "d1", thinkingFinishedAt: ts }],
    },
  };
}

async function assertBusinessState(store, snapshot, request, committed) {
  const get = (collection, key) => store.get(snapshot, collection, key);
  const page = await readImmutableOutboxPage({
    store,
    snapshot,
    consumerId: "websocket",
    limit: 10,
  });
  assert.equal(page.events.length, committed ? 1 : 0);
  assert.equal(page.hasMore, false);
  if (!committed) {
    for (const [collection, key] of [
      ["messages", "m1"],
      ["lifecycle", "t1"],
      ["timings", "t1"],
    ])
      assert.equal(await get(collection, key), null);
    assert.notEqual((await get("metadata", "session")).customTitle, "crash recovery");
    return;
  }
  const message = (await get("messages", "m1")).message;
  for (const field of [
    "messageUid",
    "userMessageId",
    "sessionId",
    "parentSessionId",
    "dialogProcessId",
    "parentDialogProcessId",
    "turnScopeId",
    "role",
    "messageOrigin",
    "type",
    "content",
    "attachments",
    "ts",
  ])
    assert.deepEqual(message[field], request.changes.messages[0][field], field);
  assert.equal((await get("lifecycle", "t1")).turnScopeId, "t1");
  assert.equal((await get("timings", "t1")).thinkingFinishedAt, ts);
  assert.equal((await get("metadata", "session")).customTitle, "crash recovery");
  return page.events[0].eventId;
}

for (const stage of ["before-head", "after-head", "before-response"]) {
  test(
    `business delta survives process termination ${stage} without partial state or duplicate outbox`,
    { timeout: 20000 },
    async (t) => {
      const store = await fixture(t);
      const initial = await store.snapshot();
      const request = requestFor(store, initial.generation);
      assert.equal((await runWriter(t, request, stage)).signal, "SIGKILL");
      const reopened = await ImmutableSessionStore.open({ sessionDir: store.sessionDir });
      const crashed = await reopened.snapshot();
      const committed = stage !== "before-head";
      assert.equal(crashed.generation, initial.generation + Number(committed));
      const eventId = await assertBusinessState(reopened, crashed, request, committed);
      await assertBusinessState(reopened, initial, request, false);
      if (stage === "before-response")
        await assert.rejects(readFile(store.lockPath), { code: "ENOENT" });
      else await utimes(store.lockPath, new Date(0), new Date(0));
      const recovered = await runWriter(t, request);
      assert.equal(recovered.replayed, committed);
      assert.equal(recovered.generation, initial.generation + 1);
      const current = await reopened.snapshot();
      const recoveredEventId = await assertBusinessState(reopened, current, request, true);
      assert.equal(recovered.result.turnTransition.committedEvent.eventId, recoveredEventId);
      if (committed) assert.equal(recoveredEventId, eventId);
      const headBytes = await readFile(store.headPath);
      assert.deepEqual(await runWriter(t, request), { ...recovered, replayed: true });
      assert.deepEqual(await readFile(store.headPath), headBytes);
      await assertBusinessState(reopened, initial, request, false);
      const audit = await auditImmutableSession({ sessionDir: store.sessionDir });
      assert.equal(audit.ok, true, JSON.stringify(audit));
      assert.equal(audit.checkedCommits, initial.generation + 1);
    },
  );
}
