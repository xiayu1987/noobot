/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";

import { emitPlanMutationRejected } from "../../src/capabilities/handlers/shared/plan/mutation-observability.js";

test("emitPlanMutationRejected appends localized reason label", () => {
  const logs = [];
  const appendCapabilityLog = (_ctx, payload) => logs.push(payload);

  emitPlanMutationRejected({
    appendCapabilityLog,
    ctx: { locale: "zh-CN" },
    domain: "planning",
    stage: "revision",
    source: "test",
    mutationResult: {
      classification: { type: "patch" },
      rejectedReason: "invalid_mutation_type",
    },
  });

  assert.equal(logs.length, 1);
  assert.equal(logs[0]?.detail?.rejectedReason, "invalid_mutation_type");
  assert.equal(logs[0]?.detail?.rejectedReasonLabel, "变更类型无效");
});
