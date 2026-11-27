/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import { request } from "node:http";
import { test } from "node:test";
import { QUANTITY_THRESHOLDS } from "@noobot/shared/quantity-thresholds";
import {
  getSessionDetailStartApi,
  getSessionDisplayPageApi,
  releaseSessionDisplayPageApi,
} from "../../../client/noobot-chat/src/infrastructure/api/chat/chatApi.js";
import { repositoryMessage as performanceMessage } from "../../../agent/__tests__/helpers/session-repository-message.js";
import { partitionRepositoryPerformanceFixture } from "../../../agent/__tests__/helpers/partition-repository-performance-fixture.js";
import { observeStorageIo } from "../../../agent/__tests__/helpers/storage-io-observation.js";
import {
  createPartitionBotFixture,
  firstSend,
  identity,
} from "../partition-bot-assembly.test-helpers.js";
import { createSessionApp, withTestServer } from "./session-routes.helpers.js";

const selection = { cursor: null, direction: "backward", limit: 1, maxBytes: 4096 };
const start = { ...selection, terminalLimit: 1, reconcileTurnScopeIds: [] };

async function fixture(t, retentionRecords, routeOptions) {
  const { service, budget, setBudget } = await createPartitionBotFixture(t);
  if (retentionRecords !== undefined) {
    setBudget({ ...budget, journalLimits: { ...budget.journalLimits, retentionRecords } });
  }
  const { bot } = await service.rebuildRuntimeConfig();
  await bot.session.applyTurnLifecycleEvent(firstSend());
  const session = {
    ...bot.session,
    getSessionDisplayData: () => assert.fail("paged requests must not export the session"),
  };
  return createSessionApp({ json: true, bot: { session }, routeOptions });
}

function send(baseUrl, path, body, method = "POST", userId = identity.userId) {
  return fetch(`${baseUrl}/internal/session/${userId}/${identity.sessionId}/${path}`, {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function client(baseUrl, { userId, sessionId }, fetcher) {
  const request = (api, selection, previous) =>
    api(
      { userId, request: { ...selection, sessionId }, previous },
      {
        fetcher:
          fetcher ?? ((path, options) => fetch(`${baseUrl}${path.slice("/api".length)}`, options)),
      },
    );
  return {
    start: () => request(getSessionDetailStartApi, start),
    next: (previous, cursor = previous.nextCursor) =>
      request(getSessionDisplayPageApi, { ...selection, cursor }, previous),
    release: (cursor) => request(releaseSessionDisplayPageApi, { cursor }),
  };
}

test("client rejects an invalid retained response and releases the issued reader", async (t) => {
  const storage = await partitionRepositoryPerformanceFixture(t);
  await storage.commit({ messages: [1, 2, 3].map((i) => performanceMessage("many-turns", i)) });
  const scope = { userId: "u1", sessionId: "s1" };
  const app = createSessionApp({ json: true, bot: { session: storage.services.session } });
  await withTestServer(app, async (baseUrl) => {
    const api = client(baseUrl, scope);
    let issued;
    const releases = [];
    const invalid = client(baseUrl, scope, async (path, options) => {
      const response = await fetch(`${baseUrl}${path.slice("/api".length)}`, options);
      if (options.method === "DELETE") {
        releases.push(await response.clone().json());
        return response;
      }
      assert.equal(response.status, 200);
      const body = await response.json();
      issued = body.page.nextCursor;
      return Response.json({ ...body, serverNow: null });
    });
    const expired = (previous) => assert.rejects(api.next(previous), { status: 410 });
    await assert.rejects(invalid.start(), { code: "SERVER_CLOCK_INVALID" });
    await expired({ nextCursor: issued });
    const { page: head } = await api.start();
    await assert.rejects(invalid.next(head), { code: "SERVER_CLOCK_INVALID" });
    assert.ok(issued.after > head.nextCursor.after, "failed continuation was not terminal");
    assert.deepEqual(
      releases.map(({ page }) => page),
      [{ released: true }, { released: true }],
    );
    await expired(head);
    await expired({ ...head, nextCursor: issued });
    const networkError = new TypeError("connection lost after response");
    for (const [damage, expected] of [
      [
        () => {
          throw networkError;
        },
        (error) => error === networkError,
      ],
      [() => new Response("{"), SyntaxError],
    ]) {
      const { page: current } = await api.start();
      const callsBefore = releases.length;
      const broken = client(baseUrl, scope, async (path, options) => {
        const response = await fetch(`${baseUrl}${path.slice("/api".length)}`, options);
        const { page } = await response.clone().json();
        if (options.method === "DELETE") {
          releases.push({ page });
          return response;
        }
        assert.ok(page.nextCursor.after > current.nextCursor.after);
        return damage();
      });
      await assert.rejects(broken.next(current), expected);
      assert.deepEqual(releases.slice(callsBefore), [{ page: { released: true } }]);
      await expired(current);
    }
    const { page: incomplete } = await api.start();
    await assert.rejects(api.next(undefined, incomplete.nextCursor), /requires its previous page/);
    await expired(incomplete);
    const { page: recovered } = await api.start();
    assert.deepEqual(await api.release(recovered.nextCursor), { released: true });
  });
});

test(
  "disconnect before detail start is sent releases the real journal reader",
  { timeout: 5000 },
  async (t) => {
    const completed = Promise.withResolvers();
    const saved = Promise.withResolvers();
    let first = true;
    const app = await fixture(t, 1, {
      runBotOperation: async (run) => {
        if (!first) return run();
        first = false;
        const operation = run();
        operation.then(() => completed.resolve(null), completed.resolve);
        return operation;
      },
    });
    const originalJson = app.response.json;
    app.response.json = function (body) {
      if (body.ok && this.req.get("x-test-disconnect") === "1") {
        saved.resolve(body.page.nextCursor);
        return this;
      }
      return originalJson.call(this, body);
    };
    await withTestServer(app, async (baseUrl) => {
      const body = JSON.stringify(start);
      const socketRequest = request(
        `${baseUrl}/internal/session/${identity.userId}/${identity.sessionId}/detail-start`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "content-length": Buffer.byteLength(body),
            "x-test-disconnect": "1",
          },
        },
      );
      socketRequest.on("error", (error) => assert.equal(error.code, "ECONNRESET"));
      socketRequest.end(body);
      try {
        const cursor = await Promise.race([
          saved.promise,
          completed.promise.then((error) => {
            throw error || new Error("page was not intercepted");
          }),
        ]);
        assert.ok(cursor);
        const api = client(baseUrl, identity);
        await assert.rejects(api.start(), {
          status: 503,
          serverErrorCode: "SESSION_PAGE_SNAPSHOT_CAPACITY",
        });
        socketRequest.destroy();
        assert.equal(await completed.promise, null);
        const expired = await send(baseUrl, "display-page", { ...selection, cursor });
        assert.equal(expired.status, 410);
        assert.equal((await expired.json()).errorCode, "SESSION_PAGE_SNAPSHOT_EXPIRED");
        const { page: next } = await api.start();
        assert.deepEqual(await api.release(next.nextCursor), { released: true });
      } finally {
        socketRequest.destroy();
      }
    });
  },
);

test("thinking detail revokes its cursor when the HTTP response is interrupted", async (t) => {
  const storage = await partitionRepositoryPerformanceFixture(t);
  await storage.commit({ messages: [1, 2].map((i) => performanceMessage("long-turn", i)) });
  const completed = Promise.withResolvers();
  let disconnect = true;
  let cursor;
  const app = createSessionApp({
    bot: { session: storage.services.session },
    routeOptions: {
      runBotOperation(run) {
        const operation = run();
        if (disconnect) operation.then(() => completed.resolve(null), completed.resolve);
        return operation;
      },
    },
  });
  const json = app.response.json;
  app.response.json = function (body) {
    if (!disconnect || !body.ok) return json.call(this, body);
    cursor = body.nextCursor;
    return this.destroy();
  };
  await withTestServer(app, async (baseUrl) => {
    const path = `${baseUrl}/internal/session/u1/s1/thinking-detail`;
    const query = (cursor) =>
      new URLSearchParams({
        dialogProcessId: "d1",
        turnScopeId: "t1",
        cursor: JSON.stringify(cursor),
        limit: "1",
      });
    const read = (cursor) => fetch(`${path}?${query(cursor)}`);
    await assert.rejects(read(null), TypeError);
    assert.equal(await completed.promise, null);
    assert.ok(cursor);
    disconnect = false;
    const expired = await read(cursor);
    assert.equal(expired.status, 410);
    assert.equal((await expired.json()).errorCode, "SESSION_PAGE_SNAPSHOT_EXPIRED");
    const start = await read(null);
    assert.equal(start.status, 200);
    const { nextCursor } = await start.json();
    assert.ok(nextCursor);
    const last = await read(nextCursor);
    assert.equal(last.status, 200);
    assert.equal((await last.json()).nextCursor, null);
  });
});

test("retained page reports both response and release failures", async () => {
  const sendFailure = new Error("response failed");
  const releaseFailure = new Error("release failed");
  const completed = Promise.withResolvers();
  const cursor = { after: 1, scope: "retained" };
  const app = createSessionApp({
    json: true,
    session: {
      getSessionDetailStart: async () => ({ nextCursor: cursor }),
      releaseSessionDisplayPage: async ({ userId, request }) => {
        assert.equal(userId, identity.userId);
        assert.deepEqual(request, { sessionId: identity.sessionId, cursor });
        throw releaseFailure;
      },
    },
    routeOptions: {
      runBotOperation(run) {
        const operation = run();
        operation.then(() => completed.resolve(null), completed.resolve);
        return operation;
      },
    },
  });
  const json = app.response.json;
  app.response.json = function (body) {
    if (body.ok) throw sendFailure;
    return json.call(this, body);
  };
  await withTestServer(app, async (baseUrl) => {
    const response = await send(baseUrl, "detail-start", start);
    assert.equal(response.status, 500);
    await response.json();
    const failure = await completed.promise;
    assert.ok(failure instanceof AggregateError);
    assert.equal(failure.cause, sendFailure);
    assert.deepEqual(failure.errors, [sendFailure, releaseFailure]);
  });
});

async function page(response) {
  const body = await response.json();
  assert.equal(response.status, 200, JSON.stringify(body));
  assert.equal(body.ok, true);
  return body.page;
}

test("partition HTTP detail start and continuation share the same snapshot without a full export", async (t) => {
  const app = await fixture(t);
  await withTestServer(app, async (baseUrl) => {
    const api = client(baseUrl, identity);
    const { page: head } = await api.start();
    assert.equal(head.messages.length, 1);
    assert.equal(head.stats.displayMessageCount, 2);
    assert.equal(head.title, firstSend().userMessage.content);
    assert.equal(head.turnLifecycleSnapshot.activeTurnScopeId, firstSend().turnScopeId);
    assert.ok(head.nextCursor);

    const continuation = { ...selection, cursor: head.nextCursor };
    assert.equal(
      (await send(baseUrl, "display-page", continuation, "POST", "other-user")).status,
      410,
    );
    const { page: tail } = await api.next(head);
    assert.equal(tail.messages.length, 1);
    assert.equal(tail.generation, head.generation);
    assert.equal(tail.aggregateVersion, head.aggregateVersion);
    assert.equal(tail.nextCursor, null);
  });
});

test("partition HTTP paging rejects invalid input and releases the retained reader", async (t) => {
  const app = await fixture(t);
  await withTestServer(app, async (baseUrl) => {
    for (const body of [[], { ...start, sessionId: "other" }, { ...start, limit: "1" }])
      assert.equal((await send(baseUrl, "detail-start", body)).status, 400);
    assert.equal((await send(baseUrl, "detail-start?limit=2", start)).status, 400);

    const { nextCursor: cursor } = await page(await send(baseUrl, "detail-start", start));
    assert.ok(cursor);
    const conflict = await send(baseUrl, "display-page", {
      ...selection,
      direction: "forward",
      cursor,
    });
    assert.equal(conflict.status, 409, await conflict.text());
    assert.deepEqual(await client(baseUrl, identity).release(cursor), {
      released: false,
    });
    const expired = await send(baseUrl, "display-page", { ...selection, cursor });
    assert.equal(expired.status, 410);
    assert.equal((await expired.json()).errorCode, "SESSION_PAGE_SNAPSHOT_EXPIRED");
  });
});

async function verifyReaderCapacity(t, { retentionRecords, admittedReaders }) {
  const app = await fixture(t, retentionRecords);
  await withTestServer(app, async (baseUrl) => {
    const api = client(baseUrl, identity);
    const cursors = [];
    for (let index = 0; index < admittedReaders; index++) {
      const { page: head } = await api.start();
      assert.ok(head.nextCursor);
      cursors.push(head.nextCursor);
    }
    await assert.rejects(api.start(), {
      status: 503,
      serverErrorCode: "SESSION_PAGE_SNAPSHOT_CAPACITY",
    });
    assert.deepEqual(await api.release(cursors.shift()), { released: true });
    const { page: recovered } = await api.start();
    assert.ok(recovered.nextCursor);
    cursors.push(recovered.nextCursor);
    for (const cursor of cursors) {
      assert.deepEqual(await api.release(cursor), { released: true });
    }
  });
}

test("exhausted journal snapshot slots report capacity and recover after release", (t) =>
  verifyReaderCapacity(t, { retentionRecords: 1, admittedReaders: 1 }));

test("exhausted shared page readers report capacity and recover after release", (t) => {
  const admittedReaders = QUANTITY_THRESHOLDS.sessionPageSnapshots.readers;
  return verifyReaderCapacity(t, { retentionRecords: admittedReaders + 1, admittedReaders });
});

test("@performance cold partition HTTP first page stays within a fixed read envelope as history grows", async (t) => {
  const storage = await partitionRepositoryPerformanceFixture(t);
  const scope = { userId: "u1", sessionId: "s1" };
  let count = 0;
  let maximum;
  let stageStarted;
  let stage;
  const enter = (name) => {
    t.signal.throwIfAborted();
    stage = name;
    stageStarted = performance.now();
  };
  t.signal.addEventListener("abort", () => {
    if (stage !== undefined)
      t.diagnostic(`${stage}: aborted after ${(performance.now() - stageStarted).toFixed(1)} ms`);
  });
  for (const history of [10, 1000, 10000]) {
    enter(`${history} messages: seed`);
    const seedStarted = stageStarted;
    while (count < history) {
      t.signal.throwIfAborted();
      const messages = Array.from({ length: Math.min(32, history - count) }, () =>
        performanceMessage("many-turns", ++count),
      );
      await storage.commit({ messages });
    }
    const seedMs = performance.now() - seedStarted;
    enter(`${history} messages: reopen`);
    const reopenStarted = stageStarted;
    await storage.reopen();
    const reopenMs = performance.now() - reopenStarted;
    const session = {
      ...storage.services.session,
      getSessionDisplayData: () => assert.fail("HTTP paging must not export history"),
    };
    const app = createSessionApp({ json: true, bot: { session } });
    await withTestServer(app, async (baseUrl) => {
      const api = client(baseUrl, scope);
      enter(`${history} messages: first page`);
      const requestStarted = stageStarted;
      const {
        result: { page: head },
        work,
      } = await observeStorageIo(storage.scope.sessionDir, api.start);
      const requestMs = performance.now() - requestStarted;
      assert.equal(head.stats.displayMessageCount, history);
      assert.deepEqual(
        head.messages.map(({ messageUid }) => messageUid),
        [`m${history}`],
      );
      assert.ok(work.readBytes > 0);
      maximum ??= work.readBytes * 1.25 + 16 * 1024;
      assert.ok(work.readBytes <= maximum, `read ${work.readBytes} bytes, maximum ${maximum}`);
      t.diagnostic(
        `${history} messages: seed ${seedMs.toFixed(1)} ms, reopen ${reopenMs.toFixed(1)} ms, ` +
          `first page ${requestMs.toFixed(1)} ms, ${work.readBytes} bytes, ${work.readCalls} reads`,
      );
      enter(`${history} messages: release`);
      assert.deepEqual(await api.release(head.nextCursor), { released: true });
    });
  }
  stage = undefined;
});
