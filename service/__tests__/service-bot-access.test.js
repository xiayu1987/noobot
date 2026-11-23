/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import { createServiceBotAccess } from "../services/service-bot-access.js";
import { express, registerSessionRoutes, withTestServer } from "./routes/session-routes.helpers.js";

test("HTTP retirement waits through awaits, rejects new requests, then publishes the next runtime", async () => {
  const entered = Promise.withResolvers();
  const release = Promise.withResolvers();
  const oldTime = "2026-11-20T00:00:00.000Z";
  const newTime = "2026-11-20T00:00:01.000Z";
  let closed = false;
  const previous = {
    session: {
      async getAllSessionSummaries() {
        entered.resolve();
        await release.promise;
        assert.equal(closed, false);
        return { sessions: [], revision: 1 };
      },
      readServerNow() {
        assert.equal(closed, false);
        return oldTime;
      },
    },
    async close() {
      closed = true;
    },
  };
  const next = {
    session: {
      getAllSessionSummaries: async () => ({ sessions: [], revision: 2 }),
      readServerNow: () => newTime,
    },
  };
  let current = previous;
  const access = createServiceBotAccess({ getBot: () => current });
  const app = express();
  registerSessionRoutes(app, {
    bot: access,
    runBotOperation: access.runOperation,
    translateText: (key) => key,
  });
  await withTestServer(app, async (baseUrl) => {
    const url = `${baseUrl}/internal/sessions/user`;
    const pending = fetch(url);
    await entered.promise;
    const retirement = access.withRetirement(async () => {
      await previous.close();
      current = next;
    });
    try {
      assert.equal(closed, false);
      assert.equal(current, previous);
      const rejected = await fetch(url);
      assert.equal(rejected.status, 503);
      assert.equal((await rejected.json()).errorCode, "RUNTIME_CLOSED");
    } finally {
      release.resolve();
    }
    const response = await pending;
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.revision, 1);
    assert.equal(body.serverNow, oldTime);
    await retirement;
    assert.equal(closed, true);
    const published = await (await fetch(url)).json();
    assert.equal(published.revision, 2);
    assert.equal(published.serverNow, newTime);
  });
});

test("operation failure drains but failed retirement blocks admission until a successful retry", async () => {
  const access = createServiceBotAccess({ getBot: () => ({ session: {} }) });
  const failure = new Error("operation failed");
  await assert.rejects(
    access.runOperation(async () => {
      throw failure;
    }),
    (cause) => cause === failure,
  );
  assert.equal(await access.withRetirement(() => "retired"), "retired");
  await assert.rejects(
    access.withRetirement(() => {
      throw failure;
    }),
    (cause) => cause === failure,
  );
  await assert.rejects(
    access.runOperation(() => "admitted"),
    { code: "RUNTIME_CLOSED" },
  );
  assert.throws(() => access.session, { code: "RUNTIME_CLOSED" });
  assert.equal(await access.withRetirement(() => "retried"), "retried");
  assert.equal(await access.runOperation(() => "admitted"), "admitted");
});

test("nested work remains admitted while retirement drains, but completed contexts cannot reopen", async () => {
  const current = { session: {} };
  const access = createServiceBotAccess({ getBot: () => current });
  const entered = Promise.withResolvers();
  const release = Promise.withResolvers();
  const resume = Promise.withResolvers();
  let inherited;
  const operation = access.runOperation(async () => {
    inherited = resume.promise.then(() => access.runOperation(() => access.session));
    entered.resolve();
    await release.promise;
    assert.equal(await access.runOperation(() => access.session), current.session);
    await assert.rejects(
      access.withRetirement(() => {}),
      /outside a service operation/,
    );
  });
  await entered.promise;
  const retirement = access.withRetirement(() => "retired");
  await assert.rejects(
    access.runOperation(() => {}),
    { code: "RUNTIME_CLOSED" },
  );
  release.resolve();
  await operation;
  await retirement;
  const rejected = assert.rejects(inherited, { code: "RUNTIME_CLOSED" });
  resume.resolve();
  await rejected;
});
