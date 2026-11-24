/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { filePath as path } from "@noobot/path-resolver";
import { SESSION_CALLER } from "@noobot/shared/session-caller";
import { QUANTITY_THRESHOLDS } from "@noobot/shared/quantity-thresholds";
import { createSessionFacade } from "../../src/session/index.js";
import { SessionTurnPersister } from "../../src/bot/execution/turn-persister.js";
import { createTestSessionServices, provisionTestSession } from "../helpers/session-services.js";
import { initializeUserWorkspace } from "../helpers/user-workspace.js";
import { createCurrentTurnMessagesStore } from "../../src/runtime/turn/current-turn-ledger.js";
import { bindCurrentTurnPersistence } from "../../src/bot/execution/runner/current-turn-persistence.js";

const timestamp = "2026-01-01T00:00:00.000Z";
const identity = { userId: "u1", sessionId: "s1", dialogProcessId: "d1", turnScopeId: "t1" };
const pageSize = QUANTITY_THRESHOLDS.sessionStorage.messagePageSize;
const { partitionSessionStorage: storageBudget } = JSON.parse(
  await readFile(
    new URL("../../../service/config/global.config.example.json", import.meta.url),
    "utf8",
  ),
);
const message = (index) => ({
  messageUid: `m${index}`,
  userMessageId: `m${index}`,
  sessionId: identity.sessionId,
  parentSessionId: "",
  dialogProcessId: identity.dialogProcessId,
  parentDialogProcessId: "",
  turnScopeId: identity.turnScopeId,
  role: "user",
  type: "message",
  messageOrigin: "natural",
  content: `record-${index}-🙂`,
  attachments: [],
  transferEnvelopes: [],
  ts: timestamp,
});

async function fixture(t) {
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), "bounded-persistence-e2e-"));
  t.after(() => rm(workspaceRoot, { recursive: true, force: true }));
  await initializeUserWorkspace(workspaceRoot, identity.userId);
  const services = createTestSessionServices(
    { workspaceRoot },
    { now: () => timestamp, ...storageBudget },
  );
  t.after(() => services.close());
  await provisionTestSession(services, { ...identity, caller: SESSION_CALLER.USER });
  const repository = services.repositories.sessionRepository;
  const persistenceContext = repository.treePersistenceContext(identity.userId, identity.sessionId);
  return { services, repository, persistenceContext, workspaceRoot };
}

function retryInNewProcess({ workspaceRoot, request }) {
  const servicesUrl = new URL("../helpers/session-services.js", import.meta.url).href;
  const child = spawnSync(
    process.execPath,
    [
      "--import",
      import.meta.resolve("@noobot/shared/testing/runtime-params"),
      "--input-type=module",
      "-e",
      `
        import { createTestSessionServices } from ${JSON.stringify(servicesUrl)};
        import { readFileSync } from "node:fs";
        import { restoreSessionCommitRequest } from ${JSON.stringify(import.meta.resolve("@noobot/session-protocol/session-changes"))};
        const { workspaceRoot, userId, sessionId, timestamp, request, storageBudget } = JSON.parse(readFileSync(0, "utf8"));
        await using runtime = createTestSessionServices(
          { workspaceRoot }, { now: () => timestamp, ...storageBudget },
        );
        const repository = runtime.repositories.sessionRepository;
        const persistenceContext = repository.treePersistenceContext(userId, sessionId);
        const outcome = await repository.withSessionReader(userId, sessionId,
          ({ commitChanges }) => commitChanges(restoreSessionCommitRequest(request)),
          { persistenceContext });
        await using reader = await repository.requireSessionReader(userId, sessionId, { persistenceContext });
        process.stdout.write(JSON.stringify({ outcome, generation: reader.generation }));
      `,
    ],
    {
      input: JSON.stringify({
        workspaceRoot,
        userId: identity.userId,
        sessionId: identity.sessionId,
        timestamp,
        storageBudget,
        request,
      }),
      encoding: "utf8",
      timeout: 15000,
    },
  );
  assert.ifError(child.error);
  assert.equal(child.status, 0, child.stderr);
  return JSON.parse(child.stdout);
}

test("bounded turn flush recovers a lost receipt and replays a body append in a fresh process", async (t) => {
  const { services, repository, persistenceContext, workspaceRoot } = await fixture(t);
  const runtime = {
    currentTurnMessages: createCurrentTurnMessagesStore(
      Array.from({ length: pageSize + 1 }, (_, index) => message(index)),
    ),
  };
  const requests = [];
  const outcomes = [];
  const changes = [];
  const submissions = [];
  const persister = new SessionTurnPersister({
    session: createSessionFacade(services),
    now: () => timestamp,
  });
  const withSessionCommit = repository.withSessionCommit.bind(repository);
  t.mock.method(repository, "withSessionCommit", (userId, sessionId, run, options) =>
    withSessionCommit(
      userId,
      sessionId,
      ({ commitChanges, ...capabilities }) =>
        run({
          ...capabilities,
          commitChanges: async (request) => {
            requests.push(request);
            const outcome = await commitChanges(request);
            outcomes.push(outcome);
            return outcome;
          },
        }),
      options,
    ),
  );
  bindCurrentTurnPersistence({
    dispatchRuntime: runtime,
    ...identity,
    persistenceScope: null,
    appendAgentMessages: async (input) => {
      changes.push(input.changes);
      submissions.push(input.submission);
      const receipts = await persister.appendAgentMessages(input);
      if (outcomes.length === 2) throw new Error("receipt interrupted after durable publication");
      return receipts;
    },
  });
  await assert.rejects(
    runtime.persistCurrentTurnMessages(),
    /receipt interrupted after durable publication/,
  );
  assert.equal(runtime.currentTurnMessages.readPendingChanges().entries.length, 1);
  runtime.currentTurnMessages.appendContentByUid(`m${pageSize}`, " confirmed suffix");
  await runtime.persistCurrentTurnMessages();
  assert.equal(outcomes.length, 4);
  assert.strictEqual(changes[2], changes[1]);
  assert.strictEqual(submissions[2], submissions[1]);
  assert.strictEqual(requests[2], requests[1]);
  assert.equal(requests[1].input.changes.messages[0].content, changes[1].messages[0].content);
  assert.equal(outcomes[2].replayed, true);
  assert.equal(outcomes[2].generation, outcomes[1].generation);
  assert.equal(outcomes[3].generation, outcomes[1].generation + 1);
  assert.equal(requests[3].input.changes.messages.length, 0);
  assert.equal(requests[3].input.changes.messageContentAppends[0].content, " confirmed suffix");
  assert.deepEqual(
    requests[3].input.changes.messageContentAppends,
    changes[3].messageContentAppends,
  );
  assert.equal(runtime.currentTurnMessages.readPendingChanges().entries.length, 0);
  const persisted = [];
  {
    await using reader = await repository.requireSessionReader(
      identity.userId,
      identity.sessionId,
      {
        persistenceContext,
      },
    );
    let after = 0;
    for (;;) {
      const page = await reader.readTurnPage({
        turnScopeId: identity.turnScopeId,
        after,
        limit: pageSize,
      });
      assert.ok(page.records.length <= pageSize);
      persisted.push(...page.records.map((record) => record.message));
      if (!page.hasMore) break;
      assert.ok(page.cursor > after);
      after = page.cursor;
    }
  }
  assert.equal(persisted.length, pageSize + 1);
  assert.equal(new Set(persisted.map((record) => record.messageUid)).size, pageSize + 1);
  assert.equal(persisted.at(-1).content, `${message(pageSize).content} confirmed suffix`);
  const { outcome: replay, generation } = retryInNewProcess({
    workspaceRoot,
    request: JSON.stringify(requests[3]),
  });
  assert.equal(replay.replayed, true);
  assert.equal(replay.generation, outcomes[3].generation);
  assert.deepEqual(replay.result, outcomes[3].result);
  assert.equal(generation, outcomes[3].generation);
});
