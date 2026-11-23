/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { createResourceRef } from "@noobot/path-resolver";
import { SESSION_CALLER } from "@noobot/shared/session-caller";
import {
  getSessionDisplayArtifactPageApi,
  releaseSessionDisplayArtifactPageApi,
} from "../../client/noobot-chat/src/infrastructure/api/chat/chatApi.js";
import { express, registerSessionRoutes, withTestServer } from "./routes/session-routes.helpers.js";
import {
  committedAt,
  createPartitionBotFixture,
  identity,
} from "./partition-bot-assembly.test-helpers.js";

test("real partition Bot HTTP retains tree artifact pages across commits and releases their cursor", async (t) => {
  const { service } = await createPartitionBotFixture(t);
  const { bot } = await service.rebuildRuntimeConfig();
  const { userId, sessionId } = identity;
  const authoritySessionId = "artifact-parent";
  await bot.session.createSession({
    ...identity,
    sessionId: authoritySessionId,
    parentSessionId: "",
    caller: SESSION_CALLER.USER,
  });
  await bot.session.createSession({
    ...identity,
    parentSessionId: authoritySessionId,
    caller: SESSION_CALLER.USER,
  });
  const { sessionDir } = await bot.session.locateSessionScope(identity);
  const repository = bot.sessionRuntime.sessionCrudService.sessionRepo;
  const persistenceContext = repository.treePersistenceContext(userId, sessionId);
  const key = { sessionId, dialogProcessId: "artifact-dialog", turnScopeId: "artifact-turn" };
  const append = (...ids) =>
    repository.withSessionReader(
      userId,
      sessionId,
      async ({ reader, commitChanges }) => {
        const messages = ids.map((id) => {
          const logical = { view: "workspace", path: `${id}.txt` };
          return {
            ...key,
            parentSessionId: authoritySessionId,
            messageUid: id,
            presentationMessageId: "artifact-presentation",
            role: "tool",
            type: "tool_result",
            tool_call_id: `call-${id}`,
            toolName: "read_file",
            content: JSON.stringify({ ok: true, path: logical }),
            attachments: [],
            ts: committedAt,
            resourceRefs: [
              createResourceRef({
                owner: userId,
                source: "workspace",
                logical,
                mimeType: "text/plain",
                capabilities: { read: true, write: false },
              }),
            ],
          };
        });
        await commitChanges(
          await reader.prepareRequest({
            operationId: `append-${ids[0]}`,
            changes: { messages },
            committedAt,
          }),
        );
      },
      { persistenceContext },
    );
  const selection = { ...key, limit: 1, maxBytes: 4096 };
  const { sessionId: _routeSessionId, ...body } = selection;
  const app = express();
  app.use(express.json());
  const disconnectedPage = Promise.withResolvers();
  const connectionClosed = Promise.withResolvers();
  const disconnectedOperation = Promise.withResolvers();
  app.use((req, res, next) => {
    if (req.get("x-test-disconnect") === "1") res.once("close", connectionClosed.resolve);
    next();
  });
  const session = {
    ...bot.session,
    async getSessionDisplayArtifactPage(input) {
      const page = await bot.session.getSessionDisplayArtifactPage(input);
      if (page?.nextCursor && disconnecting) {
        disconnectedPage.resolve(page.nextCursor);
        await connectionClosed.promise;
      }
      return page;
    },
  };
  let disconnecting = false;
  registerSessionRoutes(app, {
    bot: { session },
    async runBotOperation(run) {
      const result = run();
      if (disconnecting)
        result.then(() => disconnectedOperation.resolve(null), disconnectedOperation.resolve);
      return result;
    },
  });
  await withTestServer(app, async (baseUrl) => {
    const path = `${baseUrl}/internal/session/${userId}/${sessionId}/display-artifact-page`;
    const request = (method, selection) =>
      fetch(path, {
        method,
        headers: { "content-type": "application/json" },
        body: JSON.stringify(selection),
      });
    const fetcher = (url, options) => fetch(`${baseUrl}${url.slice("/api".length)}`, options);
    const read = async (previous = null, transport = fetcher) =>
      (
        await getSessionDisplayArtifactPageApi(
          {
            userId,
            request: { ...selection, cursor: previous === null ? null : previous.nextCursor },
            previous,
          },
          { fetcher: transport },
        )
      ).page;
    const release = (cursor) =>
      releaseSessionDisplayArtifactPageApi({ userId, request: { ...key, cursor } }, { fetcher });

    assert.equal(await read(), null);
    await append("older", "second");
    disconnecting = true;
    const controller = new AbortController();
    const abortedRequest = assert.rejects(
      fetch(path, {
        method: "POST",
        headers: { "content-type": "application/json", "x-test-disconnect": "1" },
        body: JSON.stringify({ ...body, cursor: null }),
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(5000)]),
      }),
      { name: "AbortError" },
    );
    const orphan = await Promise.race([
      disconnectedPage.promise,
      abortedRequest.then(() =>
        assert.fail("connection closed before the artifact cursor was captured"),
      ),
    ]);
    controller.abort();
    await abortedRequest;
    const operationError = await disconnectedOperation.promise;
    if (operationError !== null) throw operationError;
    disconnecting = false;
    const expired = { status: 410, serverErrorCode: "SESSION_PAGE_SNAPSHOT_EXPIRED" };
    await assert.rejects(read({ nextCursor: orphan }), expired);
    let rejectedCursor;
    const invalidClock = async (url, options) => {
      const response = await fetcher(url, options);
      if (options.method !== "POST") return response;
      const envelope = await response.json();
      assert.ok(envelope.page.nextCursor);
      rejectedCursor = envelope.page.nextCursor;
      return Response.json({ ...envelope, serverNow: null }, { status: response.status });
    };
    await assert.rejects(read(null, invalidClock), { code: "SERVER_CLOCK_INVALID" });
    await assert.rejects(read({ nextCursor: rejectedCursor }), expired);
    assert.equal((await request("POST", { ...selection, cursor: null })).status, 400);
    assert.equal((await request("POST", { ...body, cursor: null, limit: 0 })).status, 400);
    const first = await read();
    assert.equal(first.records[0].message.messageUid, "older");
    const scoped = await bot.session.readScopedDisplayArtifactPage({
      userId,
      authoritySessionId,
      sessionDir,
      request: { ...selection, cursor: null },
    });
    assert.deepEqual(scoped.records, first.records);
    await assert.rejects(read(scoped), (error) => {
      assert.ok(error instanceof AggregateError);
      assert.equal(error.cause, error.errors[0]);
      assert.equal(error.errors.length, 2);
      for (const failure of error.errors) {
        assert.equal(failure.status, expired.status);
        assert.equal(failure.serverErrorCode, expired.serverErrorCode);
      }
      return true;
    });
    await append("newest");
    const last = await read(first);
    assert.equal(last.generation, first.generation);
    assert.deepEqual(last.summary, first.summary);
    assert.equal(last.records[0].message.messageUid, "second");
    assert.equal(last.nextCursor, null);
    await assert.rejects(read(first), expired);
    const current = await read();
    assert.ok(current.generation > first.generation);
    assert.equal(current.summary.toolArtifactCount, 3);
    const changedSnapshot = async (url, options) => {
      const response = await fetcher(url, options);
      if (options.method !== "POST") return response;
      const envelope = await response.json();
      return Response.json({
        ...envelope,
        page: { ...envelope.page, generation: current.generation + 1 },
      });
    };
    await assert.rejects(read(current, changedSnapshot), /changed its retained snapshot facts/);
    assert.deepEqual(await release(current.nextCursor), { released: false });
    await assert.rejects(read(current), expired);
    const { nextCursor } = await read();
    assert.deepEqual(await release(nextCursor), { released: true });
    assert.deepEqual(await release(nextCursor), { released: false });
    await bot.session.releaseScopedDisplayArtifactPage({
      userId,
      request: { ...key, cursor: scoped.nextCursor },
      authoritySessionId,
      sessionDir,
    });
  });
});
