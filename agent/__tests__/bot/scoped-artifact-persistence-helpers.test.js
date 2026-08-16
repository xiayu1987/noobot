/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { readJsonlArtifactFile } from "../../src/session/session-artifact-store.js";
import os from "node:os";
import path from "node:path";

import { ScopedArtifactPersistenceHelpers } from "../../src/bot/session/scoped-artifact-persistence-helpers.js";
import { MIME_TYPE } from "../../src/shared/constants/index.js";

async function createTempRoot() {
  return fs.mkdtemp(path.join(os.tmpdir(), "noobot-plugin-persistence-"));
}

function createWorkspaceService(baseDir = "/tmp/noobot-plugin-persistence") {
  return {
    getWorkspacePath(userId = "") {
      return path.join(baseDir, userId);
    },
  };
}

function createHelpers({
  baseDir = "/tmp/noobot-plugin-persistence",
  session = null,
  attach = null,
  now = () => "2026-01-02T03:04:05.000Z",
} = {}) {
  return new ScopedArtifactPersistenceHelpers({
    session,
    attach,
    workspaceService: createWorkspaceService(baseDir),
    now,
  });
}

test("ScopedArtifactPersistenceHelpers resolves scoped dirs inside workspace and rejects escapes", async () => {
  const tempRoot = await createTempRoot();
  const helpers = createHelpers({ baseDir: tempRoot });

  assert.equal(
    helpers.resolveScopedDir({ userId: "u1", relativeDir: "plugin/out" }),
    path.join(tempRoot, "u1", "plugin/out"),
  );
  assert.equal(
    helpers.resolveScopedDir({
      userId: "u1",
      absoluteDir: path.join(tempRoot, "u1", "absolute/out"),
    }),
    path.join(tempRoot, "u1", "absolute/out"),
  );
  assert.throws(
    () => helpers.resolveScopedDir({ userId: "u1", relativeDir: "../escape" }),
    /plugin scoped output path must be inside workspace/,
  );
  assert.throws(
    () => helpers.resolveScopedDir({ userId: "u1", absoluteDir: path.join(tempRoot, "other") }),
    /plugin scoped output path must be inside workspace/,
  );
});

test("ScopedArtifactPersistenceHelpers scoped writer and event logger write inside workspace", async () => {
  const tempRoot = await createTempRoot();
  const helpers = createHelpers({ baseDir: tempRoot });
  const writer = helpers.createScopedJsonWriter();
  const logger = helpers.createScopedEventLogger();

  const written = await writer({
    userId: "u1",
    relativeDir: "plugin/node-a",
    fileName: "payload.json",
    payload: { ok: true },
  });
  assert.equal(written.outputFile, path.join(tempRoot, "u1", "plugin/node-a", "payload.json"));
  assert.deepEqual(JSON.parse(await fs.readFile(written.outputFile, "utf8")), { ok: true });

  const logged = await logger({
    userId: "u1",
    relativeDir: "plugin/node-a",
    fileName: "events.jsonl",
    event: { step: "done" },
  });
  const lines = (await fs.readFile(logged.outputFile, "utf8")).trim().split("\n");
  assert.equal(lines.length, 1);
  assert.deepEqual(JSON.parse(lines[0]), {
    timestamp: "2026-01-02T03:04:05.000Z",
    step: "done",
  });

  await assert.rejects(
    () => writer({ userId: "u1", relativeDir: "plugin/node-a", fileName: "../bad.json" }),
    /plugin scoped writer fileName must be plain file name/,
  );
});

test("ScopedArtifactPersistenceHelpers persists existing sub-session snapshot from session service", async () => {
  const tempRoot = await createTempRoot();
  const outputDir = path.join(tempRoot, "u1", "plugin/node-c");
  const helpers = createHelpers({
    baseDir: tempRoot,
    session: {
      async getSessionBundle(payload = {}) {
        assert.equal(payload.userId, "u1");
        assert.equal(payload.sessionId, "s1");
        return {
          session: {
            sessionId: "s1",
            messages: [
              {
                messageUid: "sm_scoped_snapshot",
                role: "assistant",
                content: "ok",
                dialogProcessId: "dialog-scoped-snapshot",
                turnScopeId: "turn-scoped-snapshot",
              },
            ],
          },
          turnTasks: [{ taskId: "t1" }],
        };
      },
      async getExecutionBundle() {
        return { sessionId: "s1", logs: [{ event: "x" }] };
      },
    },
  });

  const persisted = await helpers.persistSubSessionSnapshot({
    userId: "u1",
    sessionId: "s1",
    parentSessionId: "p1",
    outputDir,
    metadata: { kind: "snapshot" },
  });

  const taskJson = JSON.parse(await fs.readFile(persisted.files.task, "utf8"));
  const executionJson = JSON.parse(await fs.readFile(persisted.files.execution, "utf8"));
  assert.deepEqual(taskJson.tasks, [{ taskId: "t1" }]);
  assert.equal(taskJson.updatedAt, "2026-01-02T03:04:05.000Z");
  assert.deepEqual(executionJson.logs, [{ event: "x" }]);
  assert.deepEqual(await readJsonlArtifactFile(persisted.files.executionEvents), [{ event: "x" }]);
});

test("ScopedArtifactPersistenceHelpers generated artifact persister maps records to metas", async () => {
  let capturedPayload = null;
  const helpers = createHelpers({
    attach: {
      async ingestGeneratedArtifacts(payload = {}) {
        capturedPayload = payload;
        return [
          {
            attachmentId: "att1",
            sessionId: "s1",
            attachmentSource: "model",
            name: "demo.bin",
            mimeType: MIME_TYPE.TEXT_PLAIN,
            generationSource: "node",
          },
        ];
      },
    },
  });

  const persistArtifacts = helpers.createGeneratedArtifactPersister();
  const metas = await persistArtifacts({
    userId: "u1",
    sessionId: "s1",
    generationSource: "node",
    artifacts: [{ fileName: "demo.bin", content: "x" }],
    fallbackMimeType: MIME_TYPE.TEXT_PLAIN,
  });

  assert.equal(capturedPayload.userId, "u1");
  assert.equal(capturedPayload.sessionId, "s1");
  assert.equal(capturedPayload.generationSource, "node");
  assert.equal(capturedPayload.artifacts.length, 1);
  assert.equal(metas.length, 1);
  assert.equal(metas[0].attachmentId, "att1");
  assert.equal(metas[0].mimeType, MIME_TYPE.TEXT_PLAIN);
});
