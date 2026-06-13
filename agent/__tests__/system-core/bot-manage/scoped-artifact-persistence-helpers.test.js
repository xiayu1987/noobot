import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { ScopedArtifactPersistenceHelpers } from "../../../src/system-core/bot-manage/session/scoped-artifact-persistence-helpers.js";
import { MIME_TYPE } from "../../../src/system-core/constants/index.js";
import { setEventAdapter } from "../../../src/system-core/event/index.js";

async function createTempRoot() {
  return fs.mkdtemp(path.join(os.tmpdir(), "noobot-workflow-persistence-"));
}

function createWorkspaceService(baseDir = "/tmp/noobot-workflow-persistence") {
  return {
    getWorkspacePath(userId = "") {
      return path.join(baseDir, userId);
    },
  };
}

function createHelpers({
  baseDir = "/tmp/noobot-workflow-persistence",
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
    helpers.resolveScopedDir({ userId: "u1", relativeDir: "workflow/out" }),
    path.join(tempRoot, "u1", "workflow/out"),
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
    /workflow scoped output path must be inside workspace/,
  );
  assert.throws(
    () => helpers.resolveScopedDir({ userId: "u1", absoluteDir: path.join(tempRoot, "other") }),
    /workflow scoped output path must be inside workspace/,
  );
});

test("ScopedArtifactPersistenceHelpers scoped writer and event logger write inside workspace", async () => {
  const tempRoot = await createTempRoot();
  const helpers = createHelpers({ baseDir: tempRoot });
  const writer = helpers.createScopedJsonWriter();
  const logger = helpers.createScopedEventLogger();

  const written = await writer({
    userId: "u1",
    relativeDir: "workflow/node-a",
    fileName: "payload.json",
    payload: { ok: true },
  });
  assert.equal(written.outputFile, path.join(tempRoot, "u1", "workflow/node-a", "payload.json"));
  assert.deepEqual(JSON.parse(await fs.readFile(written.outputFile, "utf8")), { ok: true });

  const logged = await logger({
    userId: "u1",
    relativeDir: "workflow/node-a",
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
    () => writer({ userId: "u1", relativeDir: "workflow/node-a", fileName: "../bad.json" }),
    /workflow scoped writer fileName must be plain file name/,
  );
});

test("ScopedArtifactPersistenceHelpers normalizes detached sub-session messages with transfer and flags", () => {
  const helpers = createHelpers();
  const normalized = helpers.normalizeDetachedSubSessionMessage(
    {
      role: "tool",
      content: "payload",
      type: "tool_result",
      dialogProcessId: "d1",
      parentDialogProcessId: "pd1",
      tool_call_id: "tc1",
      attachmentMetas: [{ attachmentId: "a1", mimeType: "text/plain" }],
      transferEnvelope: { envelopeId: "e1" },
      transferResult: { envelope: { envelopeId: "e2" } },
      transferEnvelopes: [{ envelopeId: "e3" }],
      injectedMessage: true,
      injectedBy: "workflow",
      injectedMessageType: "workflow_system_context",
      frontendUserMessage: true,
    },
    "2026-02-03T04:05:06.000Z",
  );

  assert.equal(normalized.role, "tool");
  assert.equal(normalized.content, "payload");
  assert.equal(normalized.tool_call_id, "tc1");
  assert.equal(normalized.ts, "2026-02-03T04:05:06.000Z");
  assert.deepEqual(normalized.attachmentMetas, [{ attachmentId: "a1", mimeType: "text/plain" }]);
  assert.deepEqual(normalized.transferEnvelope, { envelopeId: "e1" });
  assert.deepEqual(normalized.transferResult, { envelope: { envelopeId: "e2" } });
  assert.deepEqual(normalized.transferEnvelopes, [{ envelopeId: "e3" }]);
  assert.equal(normalized.injectedMessage, true);
  assert.equal(normalized.injectedBy, "workflow");
  assert.equal(normalized.injectedMessageType, "workflow_system_context");
  assert.equal(normalized.frontendUserMessage, true);
});

test("ScopedArtifactPersistenceHelpers persists detached snapshot json files", async () => {
  const tempRoot = await createTempRoot();
  const helpers = createHelpers({ baseDir: tempRoot });
  const outputDir = path.join(tempRoot, "u1", "workflow/node-b");

  const persisted = await helpers.persistDetachedSubSessionSnapshot({
    outputDir,
    sessionPayload: {
      sessionId: "s1",
      messages: [{ role: "assistant", content: "done" }],
    },
    taskPayload: { sessionId: "s1", tasks: [] },
    executionPayload: { sessionId: "s1", logs: [] },
    metadata: { workflowNodeId: "node-b" },
  });

  assert.equal(persisted.outputDir, outputDir);
  assert.deepEqual(JSON.parse(await fs.readFile(persisted.files.meta, "utf8")), {
    workflowNodeId: "node-b",
  });
  const sessionJson = JSON.parse(await fs.readFile(persisted.files.session, "utf8"));
  assert.equal(sessionJson.sessionId, "s1");
  assert.equal(sessionJson.messages[0].content, "done");
});

test("ScopedArtifactPersistenceHelpers persists existing sub-session snapshot from session service", async () => {
  const tempRoot = await createTempRoot();
  const outputDir = path.join(tempRoot, "u1", "workflow/node-c");
  const helpers = createHelpers({
    baseDir: tempRoot,
    session: {
      async getSessionBundle(payload = {}) {
        assert.equal(payload.userId, "u1");
        assert.equal(payload.sessionId, "s1");
        return {
          session: { sessionId: "s1", messages: [{ role: "assistant", content: "ok" }] },
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
});

test("ScopedArtifactPersistenceHelpers detects detached sub-session isolation leaks", async () => {
  const tempRoot = await createTempRoot();
  const helpers = createHelpers({ baseDir: tempRoot });
  const leakedFile = path.join(tempRoot, "u1", "runtime/session", "s-leak", "session.json");
  await fs.mkdir(path.dirname(leakedFile), { recursive: true });
  await fs.writeFile(leakedFile, "{}\n", "utf8");
  const events = [];
  setEventAdapter({
    emit(payload = {}) {
      events.push(payload);
    },
  });
  let isolated = false;
  let leaked = true;
  try {
    isolated = await helpers.assertDetachedSubSessionIsolation({
      userId: "u1",
      sessionId: "s-ok",
    });
    leaked = await helpers.assertDetachedSubSessionIsolation({
      userId: "u1",
      sessionId: "s-leak",
      eventListener: () => {},
      scope: "test_scope",
    });
  } finally {
    setEventAdapter(null);
  }

  assert.equal(isolated, true);
  assert.equal(leaked, false);
  assert.equal(events[0].event, "workflow_subsession_persistence_leak");
  assert.equal(events[0].data.scope, "test_scope");
  assert.equal(events[0].data.leakedMainSessionFile, leakedFile);
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
            fileName: "demo.bin",
            mimeType: MIME_TYPE.TEXT_PLAIN,
            attachmentSource: "model",
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
