/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import test from "node:test";
import { maybeAttachChecklistArtifactsAtFinalOutput } from "../../src/capabilities/handlers/acceptance/output-finalizer.js";

test("harness rejects malformed final output before state or artifact writes", async () => {
  for (const messages of [
    undefined,
    null,
    {},
    [null],
    [{}],
    new Array(1),
    [{ messageUid: "mu1" }, { messageUid: "mu1" }],
  ]) {
    let writes = 0;
    const ctx = {
      result: {
        output: "done",
        traces: [],
        modelMessages: [],
        modelLoopRound: 0,
        turnMessages: messages,
      },
      agentContext: {
        bindings: {
          extensions: {},
          runtime: {
            sharedTools: {
              semanticTransfer: {
                async transferSemanticContent() {
                  writes += 1;
                  throw new Error("must not transfer");
                },
              },
            },
          },
        },
      },
    };
    const before = structuredClone(ctx.result);
    await assert.rejects(maybeAttachChecklistArtifactsAtFinalOutput(ctx), {
      code: "AGENT_TURN_RESULT_INVALID",
    });
    assert.deepEqual(ctx.result, before);
    assert.deepEqual(ctx.agentContext.bindings.extensions, {});
    assert.equal(writes, 0);
  }
});
