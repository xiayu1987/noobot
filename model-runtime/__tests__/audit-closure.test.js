/* Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  ModelProtocolError,
  classifyModelFailure,
  MODEL_RECOVERY_ACTION,
  resolveModelFailureRecovery,
} from "@noobot/model-protocol";
import { createMeasuredFetch } from "../src/executor/request-measurement.js";

test("protocol failures have an explicit category and cannot replay in another transfer mode", () => {
  const classification = classifyModelFailure(new ModelProtocolError("missing terminal"), () => {
    assert.fail("protocol failure must not call adapter classifier");
  });
  assert.deepEqual(classification, {
    kind: "protocol",
    classificationError: null,
  });
  assert.equal(resolveModelFailureRecovery(classification).action, MODEL_RECOVERY_ACTION.STOP);
});

test("prefix baseline is isolated by executor and scope, with exact block boundary bytes", async () => {
  const makeExecutor = () => {
    const starts = [];
    const fetch = createMeasuredFetch({
      fetchImpl: async () => Response.json({ choices: [{ finish_reason: "stop" }] }),
      previousBodies: new Map(),
      invocation: { invocationId: "i", sessionId: "s", parentSessionId: "", flow: "test" },
      model: { model: "m" },
      operationKind: "chat",
      attempt: () => 1,
      observe: (type, data) => {
        if (type === "model.request.started") starts.push(data.prefix);
      },
    });
    return { fetch, starts };
  };
  const url = "https://provider.test/v1/chat/completions";
  for (const offset of [0, 4095, 4096, 4097, 8192]) {
    const executor = makeExecutor();
    const prefix = "a".repeat(offset);
    for (const body of [prefix + "中A", prefix + "中B"])
      await (await executor.fetch(url, { method: "POST", body })).text();
    assert.equal(executor.starts[0].baseline, "no_previous_request");
    assert.equal(executor.starts[1].commonPrefixBytes, offset + 3);
    await (await executor.fetch(url + "/other", { method: "POST", body: prefix + "中B" })).text();
    assert.equal(executor.starts[2].baseline, "no_previous_request");
    const next = makeExecutor();
    await (await next.fetch(url, { method: "POST", body: prefix + "中B" })).text();
    assert.equal(next.starts[0].baseline, "no_previous_request");
  }
});
