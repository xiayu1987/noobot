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

import { createCollabArtifactPersistor } from "../../../src/system-core/tools/collaboration/agent-collab/collab-artifact-persist.js";
import { TASK_STATUS } from "../../../src/system-core/bot-manage/async/constants.js";

async function readJsonl(filePath) {
  const content = await fs.readFile(filePath, "utf8");
  return content.trim().split(/\n+/).filter(Boolean).map((line) => JSON.parse(line));
}

test("collab artifact persistor writes failed attachment persistence to runtime-events session system event", async () => {
  const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "noobot-collab-artifact-"));
  const runtime = {
    globalConfig: { workspaceRoot },
    systemRuntime: { sessionId: "s-root" },
  };
  const persistor = createCollabArtifactPersistor({
    runtime,
    rootSessionId: "s-root",
    userId: "u1",
    attachmentService: {
      async ingestGeneratedArtifacts() {
        throw new Error("ingest failed");
      },
    },
    patchAsyncResultTask() {
      throw new Error("should not patch failed persistence");
    },
    tAgentCollab() {
      return "no result";
    },
  });

  const result = await persistor({
    container: {
      id: "c1",
      parentSessionId: "parent-s1",
      tasks: [],
    },
    taskResults: [{
      status: TASK_STATUS.COMPLETED,
      request: { sessionId: "child-s1", taskName: "Child Task" },
      result: "done",
    }],
  });

  assert.deepEqual(result, { attachments: [], transferEnvelopes: [] });

  const records = await readJsonl(path.join(
    workspaceRoot,
    "u1",
    "runtime",
    "session",
    "s-root",
    "events",
    "system.jsonl",
  ));
  assert.equal(records.length, 1);
  assert.equal(records[0].source, "agent");
  assert.equal(records[0].channel, "direct");
  assert.equal(records[0].category, "system");
  assert.equal(records[0].event, "agent.collab.persistCompletedTaskResultsAsAttachments.failed");
  assert.equal(records[0].userId, "u1");
  assert.equal(records[0].sessionId, "s-root");
  assert.equal(records[0].parentSessionId, "parent-s1");
  assert.equal(records[0].data.containerId, "c1");
  assert.equal(records[0].data.error, "ingest failed");
});
