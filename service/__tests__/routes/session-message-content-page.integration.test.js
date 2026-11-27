/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { SESSION_CALLER } from "@noobot/shared/session-caller";
import { sessionMessagePreviewLimits } from "@noobot/session-protocol/message-preview";
import { createSessionFacade } from "noobot-agent/session";
import {
  getSessionDetailStartApi,
  getSessionMessageContentPageApi,
} from "../../../client/noobot-chat/src/infrastructure/api/chat/chatApi.js";
import {
  createTestSessionServices,
  provisionTestSession,
  commitTestSessionChanges,
} from "../../../agent/__tests__/helpers/session-services.js";
import { initializeUserWorkspace } from "../../../agent/__tests__/helpers/user-workspace.js";
import { createSessionApp, withTestServer } from "./session-routes.helpers.js";
import { partitionRepositoryPerformanceFixture } from "../../../agent/__tests__/helpers/partition-repository-performance-fixture.js";
import { repositoryMessage as performanceMessage } from "../../../agent/__tests__/helpers/session-repository-message.js";
import { observeStorageIo } from "../../../agent/__tests__/helpers/storage-io-observation.js";

const ts = "2026-01-01T00:00:00.000Z";
const identity = { userId: "u1", sessionId: "s1" };
const first = {
  messageUid: "message",
  byteOffset: 0,
  maxBytes: 17,
  expectedContentReference: null,
};

async function fixture(t, content, { appendChunkChars = content.length || 1 } = {}) {
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), "session-content-http-"));
  const runtime = createTestSessionServices({ workspaceRoot }, { now: () => ts });
  t.after(async () => {
    await runtime.close();
    await rm(workspaceRoot, { recursive: true, force: true });
  });
  await initializeUserWorkspace(workspaceRoot, identity.userId);
  await provisionTestSession(runtime, { ...identity, caller: SESSION_CALLER.USER });
  const turn = { dialogProcessId: "d1", turnScopeId: "t1" };
  const creation = await commitTestSessionChanges(runtime, {
    ...identity,
    changes: {
      messages: [
        {
          messageUid: first.messageUid,
          userMessageId: first.messageUid,
          sessionId: identity.sessionId,
          parentSessionId: "",
          ...turn,
          parentDialogProcessId: "",
          role: "user",
          type: "message",
          messageOrigin: "natural",
          content: content.slice(0, appendChunkChars),
          attachments: [],
          transferEnvelopes: [],
          ts,
        },
      ],
    },
  });
  let [receipt] = creation.result.messageReceipts;
  for (let start = appendChunkChars; start < content.length; start += appendChunkChars) {
    const { result } = await commitTestSessionChanges(runtime, {
      ...identity,
      changes: {
        messageContentAppends: [
          {
            ...turn,
            messageUid: first.messageUid,
            owner: receipt.owner,
            expectedContentReference: receipt.contentReference,
            content: content.slice(start, start + appendChunkChars),
          },
        ],
      },
    });
    [receipt] = result.messageReceipts;
  }
  const session = createSessionFacade(runtime);
  session.getSessionDisplayData = () => assert.fail("content reads must not export the session");
  return {
    runtime,
    workspaceRoot,
    receipt,
    app: createSessionApp({ json: true, bot: { session } }),
  };
}

function read(baseUrl, body, suffix = "") {
  return fetch(`${baseUrl}/internal/session/u1/s1/message-content-page${suffix}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

test("HTTP content pages preserve JSON/Unicode bytes through the real session facade", async (t) => {
  const content = '你好🌏\\\"\n\u0000\ud800'.repeat(20);
  const { app } = await fixture(t, content);
  await withTestServer(app, async (baseUrl) => {
    const chunks = [];
    let request = first;
    for (;;) {
      const response = await read(baseUrl, request);
      assert.equal(response.status, 200, await response.clone().text());
      const { ok, page } = await response.json();
      assert.equal(ok, true);
      assert.equal(page.encoding, "json-utf8-base64");
      const chunk = Buffer.from(page.dataBase64, "base64");
      assert.ok(chunk.length <= request.maxBytes);
      assert.equal(page.nextByteOffset, request.byteOffset + chunk.length);
      chunks.push(chunk);
      if (!page.hasMore) break;
      request = {
        ...first,
        byteOffset: page.nextByteOffset,
        expectedContentReference: page.contentReference,
      };
    }
    assert.deepEqual(JSON.parse(Buffer.concat(chunks).toString("utf8")), content);
  });
});

test("a terminal display page decodes only its selected body version through the browser transport", async (t) => {
  const content = '你好🌏"\\\n'.repeat(2048);
  const storage = await partitionRepositoryPerformanceFixture(t);
  const { result } = await storage.commit({
    messages: [{ ...performanceMessage("long-turn", 1), content }],
  });
  const [receipt] = result.messageReceipts;
  const app = createSessionApp({ json: true, bot: { session: storage.services.session } });
  await withTestServer(app, async (baseUrl) => {
    const fetcher = (path, options) => fetch(`${baseUrl}${path.slice("/api".length)}`, options);
    const { page } = await getSessionDetailStartApi(
      {
        userId: identity.userId,
        request: {
          sessionId: identity.sessionId,
          direction: "forward",
          cursor: null,
          limit: 1,
          maxBytes: 4096,
          terminalLimit: 1,
          reconcileTurnScopeIds: [],
        },
      },
      { fetcher },
    );
    assert.equal(page.nextCursor, null);
    const [row] = page.messages;
    assert.equal(Object.hasOwn(row, "content"), false);
    assert.equal(row.contentReference, receipt.contentReference);
    assert.equal(row.contentBytes, Buffer.byteLength(JSON.stringify(content)));
    const body = (byteOffset, options = {}) =>
      getSessionMessageContentPageApi(
        { ...identity, row, byteOffset, maxBytes: 1021 },
        { fetcher, ...options },
      );
    const cancelled = AbortSignal.abort(new Error("body cancelled"));
    await assert.rejects(body(0, { signal: cancelled }), (error) => error === cancelled.reason);
    await assert.rejects(
      body(0, {
        fetcher: async (path, options) => {
          const response = await fetcher(path, options);
          const envelope = await response.json();
          return Response.json({
            ...envelope,
            page: { ...envelope.page, dataBase64: "?".repeat(envelope.page.dataBase64.length) },
          });
        },
      }),
      TypeError,
    );
    const chunks = [];
    let byteOffset = 0;
    do {
      const range = await body(byteOffset);
      chunks.push(range.bytes);
      byteOffset = range.nextByteOffset;
      if (!range.hasMore) break;
    } while (byteOffset < row.contentBytes);
    assert.equal(byteOffset, row.contentBytes);
    assert.equal(JSON.parse(Buffer.concat(chunks).toString("utf8")), content);

    await storage.commit({
      messageContentAppends: [
        {
          messageUid: row.messageUid,
          dialogProcessId: "d1",
          turnScopeId: "t1",
          expectedContentReference: row.contentReference,
          owner: receipt.owner,
          content: " changed",
        },
      ],
    });
    for (const offset of [0, 1021]) {
      await assert.rejects(body(offset), {
        status: 409,
        serverErrorCode: "SESSION_MESSAGE_CONTENT_VERSION_CONFLICT",
      });
    }
  });
});

test("HTTP rejects malformed ranges and reports missing messages and changed content", async (t) => {
  const { runtime, app, receipt } = await fixture(t, "original content");
  await withTestServer(app, async (baseUrl) => {
    for (const body of [
      {},
      [],
      { ...first, maxBytes: 0 },
      { ...first, maxBytes: "17" },
      { ...first, byteOffset: 1 },
      { ...first, persistenceScope: { pluginId: "other" } },
    ])
      assert.equal((await read(baseUrl, body)).status, 400);
    assert.equal((await read(baseUrl, first, "?maxBytes=99")).status, 400);
    const missing = await read(baseUrl, { ...first, messageUid: "missing" });
    assert.equal(missing.status, 404);
    assert.equal((await missing.json()).errorCode, "SESSION_MESSAGE_NOT_FOUND");
    const response = await read(baseUrl, { ...first, maxBytes: 3 });
    const { page } = await response.json();
    await commitTestSessionChanges(runtime, {
      ...identity,
      changes: {
        messageContentAppends: [
          {
            messageUid: first.messageUid,
            dialogProcessId: "d1",
            turnScopeId: "t1",
            expectedContentReference: page.contentReference,
            owner: receipt.owner,
            content: " updated",
          },
        ],
      },
    });
    const conflict = await read(baseUrl, {
      ...first,
      byteOffset: page.nextByteOffset,
      expectedContentReference: page.contentReference,
    });
    assert.equal(conflict.status, 409);
    assert.equal((await conflict.json()).errorCode, "SESSION_MESSAGE_CONTENT_VERSION_CONFLICT");
  });
});

test("@performance HTTP content E2E reads bounded tail pages as message bodies grow", async (t) => {
  for (const size of [64 * 1024, 1024 * 1024, 4 * 1024 * 1024]) {
    const content = "x".repeat(size);
    const { app, workspaceRoot } = await fixture(t, content, { appendChunkChars: 8192 });
    await withTestServer(app, async (baseUrl) => {
      const response = await read(baseUrl, { ...first, maxBytes: 4096 });
      assert.equal(response.status, 200);
      const { page: initial } = await response.json();
      const tailOffset = initial.totalBytes - 4096;
      const latencies = [];
      const readBytes = [];
      for (let sample = 0; sample < 16; sample += 1) {
        const started = performance.now();
        const { result: response, work } = await observeStorageIo(workspaceRoot, () =>
          read(baseUrl, {
            ...first,
            byteOffset: tailOffset,
            maxBytes: 4096,
            expectedContentReference: initial.contentReference,
          }),
        );
        readBytes.push(work.readBytes);
        assert.equal(response.status, 200);
        const { page } = await response.json();
        latencies.push(performance.now() - started);
        assert.equal(page.hasMore, false);
        assert.equal(Buffer.from(page.dataBase64, "base64").toString(), `${"x".repeat(4095)}"`);
      }
      assert.ok(
        readBytes.every((bytes) => bytes > 0 && bytes < 256 * 1024),
        JSON.stringify(readBytes),
      );
      latencies.sort((a, b) => a - b);
      t.diagnostic(
        JSON.stringify({
          bodyBytes: size,
          pageBytes: 4096,
          maxStorageReadBytes: Math.max(...readBytes),
          p50Ms: latencies[7],
          p99Ms: latencies[15],
          samples: latencies.length,
        }),
      );
    });
  }
});

test("@performance HTTP session list E2E reads bounded previews as last-message bodies grow", async (t) => {
  const maxima = [];
  for (const size of [64 * 1024, 1024 * 1024, 4 * 1024 * 1024]) {
    const { app, workspaceRoot } = await fixture(t, "x".repeat(size), { appendChunkChars: 8192 });
    await withTestServer(app, async (baseUrl) => {
      const latencies = [];
      const readBytes = [];
      for (let sample = 0; sample < 16; sample += 1) {
        const started = performance.now();
        const { result: response, work } = await observeStorageIo(workspaceRoot, () =>
          fetch(`${baseUrl}/internal/sessions/u1`),
        );
        readBytes.push(work.readBytes);
        assert.equal(response.status, 200, await response.clone().text());
        const payload = await response.json();
        latencies.push(performance.now() - started);
        assert.equal(payload.ok, true);
        assert.equal(payload.sessions.length, 1);
        const summary = payload.sessions[0];
        assert.equal(summary.availability, "available");
        assert.equal(summary.messageCount, 1);
        assert.equal(summary.lastMessage.messageUid, first.messageUid);
        assert.equal(summary.lastMessage.content, "x".repeat(sessionMessagePreviewLimits().chars));
        assert.equal(summary.lastMessage.contentTruncated, true);
      }
      assert.ok(
        readBytes.every((bytes) => bytes > 0 && bytes < 128 * 1024),
        JSON.stringify(readBytes),
      );
      const maximum = Math.max(...readBytes);
      maxima.push(maximum);
      latencies.sort((a, b) => a - b);
      t.diagnostic(
        JSON.stringify({
          operation: "http-session-list",
          bodyBytes: size,
          maxStorageReadBytes: maximum,
          p50Ms: latencies[7],
          sampleMaxMs: latencies[15],
          samples: latencies.length,
        }),
      );
    });
  }

  assert.ok(Math.max(...maxima) < Math.min(...maxima) * 2);
});
