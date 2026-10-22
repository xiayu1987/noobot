/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import { HOOK_PHASE_STATUS, HOOK_POINT } from "@noobot/hook-protocol";

import { emitSemanticTransferValidation } from "../../src/transfer-adapter/core/validation-events.js";

function createRecordingRuntime() {
  const events = [];
  const hooks = [];
  return {
    events,
    hooks,
    runtime: {
      eventListener: { onEvent: (envelope) => events.push(envelope) },
      hookManager: {
        on: () => () => {},
        emit: async (point, context) => {
          hooks.push({ point, context });
          return { failures: [] };
        },
      },
    },
  };
}

test("semantic transfer validation emits scenario and envelope count only", async () => {
  const { runtime, events, hooks } = createRecordingRuntime();
  const payload = await emitSemanticTransferValidation({
    runtime,
    scenario: "workflow",
    transferEnvelopes: [{}, {}],
  });

  assert.deepEqual(payload, { scenario: "workflow", envelopeCount: 2 });
  assert.equal(events[0].event, "semantic_transfer_validation");
  assert.deepEqual(events[0].data, payload);
  assert.equal(hooks[0].point, HOOK_POINT.AGENT.SEMANTIC_TRANSFER_VALIDATION);
  assert.equal(hooks[0].context.phase, "semantic_transfer");
  assert.equal(hooks[0].context.status, HOOK_PHASE_STATUS.SUCCESS);
  assert.equal(hooks[0].context.envelopeCount, 2);
});

test("semantic transfer validation requires the envelope list", async () => {
  const { runtime } = createRecordingRuntime();
  await assert.rejects(
    () => emitSemanticTransferValidation({ runtime, scenario: "harness" }),
    TypeError,
  );
});
