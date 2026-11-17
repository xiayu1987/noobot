/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import { requireDetachedSessionMetadata } from "@noobot/session-protocol";
import { createDetachedSubSessionRunner } from "../../src/bot/session/detached-subsession-runner.js";
import {
  DETACHED_REQUEST_METADATA,
  createCompleteStrategy,
  createDeps,
  createParentExecutionScope,
} from "./detached-subsession-runner.test-helpers.js";

test("caller metadata cannot replace host identity or runtime plugin state before any side effect", async (t) => {
  for (const field of [
    "userId",
    "sessionId",
    "parentSessionId",
    "parentDialogProcessId",
    "dialogProcessId",
    "runtimePluginState",
  ]) {
    await t.test(field, async () => {
      const metadata = { ...DETACHED_REQUEST_METADATA, [field]: "invented" };
      assert.throws(() => requireDetachedSessionMetadata(metadata), {
        code: "SESSION_DETACHED_METADATA_INVALID",
      });
      const { calls, deps } = createDeps();
      await assert.rejects(
        createDetachedSubSessionRunner(deps)({
          abortSignal: new AbortController().signal,
          parentExecutionScope: createParentExecutionScope(),
          strategy: createCompleteStrategy(),
          message: "hello",
          metadata,
        }),
        { code: "SESSION_DETACHED_METADATA_INVALID" },
      );
      assert.equal(calls.loadedWorkspacePath, "");
      assert.equal(calls.mergePayload, null);
      assert.deepEqual(calls.lifecyclePayloads, []);
      assert.deepEqual(calls.metadataWrites, []);
      assert.deepEqual(calls.runSessionPayloads, []);
    });
  }
});

test("caller metadata preserves caller-owned facts and requires an explicit scope", () => {
  const metadata = {
    scope: "workflow_node",
    nodeId: "node-1",
    workflowSessionId: "parent-1",
    origin: { nodeExecutionId: "node-execution-1" },
  };
  assert.equal(requireDetachedSessionMetadata(metadata), metadata);
  for (const invalid of [undefined, null, [], "scope", {}, { scope: " " }]) {
    assert.throws(() => requireDetachedSessionMetadata(invalid), /metadata.scope/);
  }
});

test("initial metadata commit failure prevents execution and processing start", async () => {
  const { calls, deps } = createDeps();
  const failure = Object.assign(new Error("metadata disk failure"), { code: "EIO" });
  deps.session.applyTurnLifecycleEvent = async (event) => {
    calls.lifecyclePayloads.push(event);
    throw failure;
  };
  await assert.rejects(
    createDetachedSubSessionRunner(deps)({
      abortSignal: new AbortController().signal,
      parentExecutionScope: createParentExecutionScope(),
      strategy: createCompleteStrategy(),
      message: "hello",
      attachments: [],
      metadata: DETACHED_REQUEST_METADATA,
    }),
    /metadata disk failure/,
  );
  assert.deepEqual(calls.runSessionPayloads, []);
  assert.deepEqual(
    calls.lifecyclePayloads.map((event) => event.eventType),
    ["turn.action_accepted"],
  );
  assert.equal(
    calls.lifecyclePayloads[0].initialSessionMetadata.scope,
    DETACHED_REQUEST_METADATA.scope,
  );
  assert.deepEqual(calls.metadataWrites, []);
});
