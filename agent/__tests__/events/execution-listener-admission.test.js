/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import test from "node:test";
import { createExecutionEventListener } from "../../src/events/execution-listener.js";
import { EXECUTION_LOG_BATCH_MAX_RECORDS } from "@noobot/session-protocol";

for (const fail of [false, true]) {
  test(`awaited diagnostic admission batches behind blocked storage and flush reports ${fail ? "failure" : "success"}`, async (t) => {
    const started = Promise.withResolvers();
    const release = Promise.withResolvers();
    t.after(() => release.resolve());
    const batches = [];
    const listener = createExecutionEventListener({
      userId: "u1",
      sessionId: "s1",
      parentSessionId: "",
      dialogProcessId: "d1",
      turnScopeId: "t1",
      persistenceScope: null,
      now: () => "2026-11-15T00:00:00.000Z",
      sessionManager: {
        async appendExecutionLogs({ records }) {
          batches.push(records.map(({ data }) => data.sequence));
          if (batches.length === 1) {
            started.resolve();
            await release.promise;
            if (fail) throw new Error("injected disk failure");
          }
        },
      },
    });
    const emit = (sequence) =>
      listener.onEvent({ event: "model_context_trace", data: { sequence } });
    assert.equal(emit(0), undefined);
    await started.promise;

    for (let sequence = 1; sequence <= 205; sequence += 1) await emit(sequence);
    assert.equal(batches.length, 1);
    let completed = false;
    const completion = listener.flush().then(
      () => {
        completed = true;
      },
      (error) => {
        completed = true;
        throw error;
      },
    );
    await Promise.resolve();
    assert.equal(completed, false);
    release.resolve();
    if (fail) await assert.rejects(completion, { code: "EXECUTION_LOG_PERSISTENCE_FAILED" });
    else await completion;
    assert.deepEqual(
      batches.flat(),
      Array.from({ length: 206 }, (_, index) => index),
    );
    assert.deepEqual(
      batches.map((batch) => batch.length),
      [1, 100, 100, 5],
    );
    assert.ok(batches.every((batch) => batch.length <= EXECUTION_LOG_BATCH_MAX_RECORDS));
  });
}
