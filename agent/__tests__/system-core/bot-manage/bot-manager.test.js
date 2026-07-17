/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { BotManager } from "../../../src/system-core/bot-manage/index.js";

function createBotManagerWithMocks(mocks = {}) {
  const manager = Object.create(BotManager.prototype);
  Object.assign(manager, mocks);
  return manager;
}

test("BotManager should delegate workspace/config/session calls", async () => {
  const manager = createBotManagerWithMocks({
    workspaceService: {
      getWorkspacePath(userId) {
        return `/workspace/${userId}`;
      },
      async ensureUserWorkspace(userId) {
        return { ok: true, userId };
      },
    },
    configService: {
      async loadUserConfig(basePath) {
        return { loaded: true, basePath };
      },
    },
    sessionRunner: {
      async runSession(payload = {}) {
        return { type: "run", payload };
      },
      async persistStoppedAssistantMessage(payload = {}) {
        return { type: "persist", payload };
      },
    },
  });

  assert.equal(manager.getWorkspacePath("u1"), "/workspace/u1");
  assert.deepEqual(await manager.ensureUserWorkspace("u1"), { ok: true, userId: "u1" });
  assert.deepEqual(await manager.loadUserConfig("/workspace/u1"), {
    loaded: true,
    basePath: "/workspace/u1",
  });
  assert.equal((await manager.runSession({ x: 1 })).type, "run");
  assert.equal(typeof manager.startNewSession, "undefined");
  assert.equal(typeof manager.continueSession, "undefined");
  assert.equal((await manager.persistStoppedAssistantMessage({ x: 2 })).type, "persist");
});

test("BotManager should delegate async-job and attachment operations", async () => {
  const manager = createBotManagerWithMocks({
    asyncJobManager: {
      runAsyncSession(payload = {}) {
        return { queued: true, payload };
      },
      async waitAsyncSession(payload = {}) {
        return { done: true, payload };
      },
    },
    attach: {
      getAttachmentById(payload = {}) {
        return { found: true, payload };
      },
      deleteScopedAttachmentsBySessionIds(payload = {}) {
        return { deleted: true, payload };
      },
    },
    errorLogger: {
      async log(payload = {}) {
        return { logged: true, payload };
      },
    },
  });

  assert.equal(manager.runAsyncSession({ sessionId: "s1" }).queued, true);
  assert.equal((await manager.waitAsyncSession({ sessionId: "s1" })).done, true);
  assert.equal(manager.getAttachmentById({ attachmentId: "a1" }).found, true);
  assert.equal(
    manager.deleteScopedAttachmentsBySessionIds({ userId: "u1", sessionIds: ["s1"] }).deleted,
    true,
  );
  assert.equal((await manager._logSystemError({ message: "err" })).logged, true);
});

test("BotManager replaceSessionTurn ingests uploads before persisting the replacement", async () => {
  const calls = [];
  const manager = createBotManagerWithMocks({
    globalConfig: { workspaceRoot: "/workspace", attachments: {} },
    workspaceService: {
      async ensureUserWorkspace(userId) {
        calls.push(["ensure", userId]);
      },
      getWorkspacePath(userId) {
        return `/workspace/${userId}`;
      },
    },
    configService: {
      async loadUserConfig(basePath) {
        calls.push(["config", basePath]);
        return {};
      },
    },
    attach: {
      async ingest(payload) {
        calls.push(["ingest", payload]);
        return [{
          attachmentId: "canonical-1",
          sessionId: payload.sessionId,
          attachmentSource: "user",
          name: "new.txt",
          mimeType: "text/plain",
          path: "/workspace/u1/runtime/attach/new.txt",
          relativePath: "runtime/attach/new.txt",
        }];
      },
    },
    session: {
      async replaceTurn(payload) {
        calls.push(["replace", payload]);
        return { session: { sessionId: payload.sessionId }, attachments: payload.attachments };
      },
    },
  });

  const result = await manager.replaceSessionTurn({
    userId: "u1",
    sessionId: "s1",
    newContent: "edited",
    attachments: [{ name: "new.txt", mimeType: "text/plain", contentBase64: "bmV3" }],
  });

  assert.deepEqual(calls.map(([name]) => name), ["ensure", "config", "ingest", "replace"]);
  assert.equal(calls[2][1].attachments[0].contentBase64, "bmV3");
  assert.deepEqual(calls[3][1].attachments, [{
    attachmentId: "canonical-1",
    sessionId: "s1",
    attachmentSource: "user",
    name: "new.txt",
    mimeType: "text/plain",
    path: "/workspace/u1/runtime/attach/new.txt",
    relativePath: "runtime/attach/new.txt",
  }]);
  assert.equal(result.attachments[0].attachmentId, "canonical-1");
});

test("BotManager should cleanup session-scoped tool-result-overflow directories", async () => {
  const basePath = await fs.mkdtemp(path.join(os.tmpdir(), "noobot-overflow-cleanup-"));
  const overflowRoot = path.join(basePath, "runtime", "ops_workdir", ".tool-result-overflow");
  const sessionDeleteDir = path.join(overflowRoot, "session-delete");
  const sessionKeepDir = path.join(overflowRoot, "session-keep");
  await fs.mkdir(sessionDeleteDir, { recursive: true });
  await fs.mkdir(sessionKeepDir, { recursive: true });
  await fs.writeFile(path.join(sessionDeleteDir, "sample.json"), "{\"ok\":true}", "utf8");
  await fs.writeFile(path.join(sessionKeepDir, "sample.json"), "{\"ok\":true}", "utf8");

  const manager = createBotManagerWithMocks({
    workspaceService: {
      getWorkspacePath() {
        return basePath;
      },
    },
  });

  const result = await manager.deleteToolResultOverflowBySessionIds({
    userId: "u1",
    sessionIds: ["session-delete"],
  });
  assert.deepEqual(result, {
    deletedSessionIds: ["session-delete"],
    deletedCount: 1,
  });

  await assert.rejects(fs.access(sessionDeleteDir));
  await fs.access(sessionKeepDir);
});
