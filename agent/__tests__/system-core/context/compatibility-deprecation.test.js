/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";

import {
  getAgentContextCompatFieldHitStats,
  resetAgentContextCompatFieldHitStats,
  warnAgentContextCompatFieldOnce,
} from "../../../src/system-core/context/compatibility-deprecation.js";

test("compat field hit stats should accumulate by field", () => {
  resetAgentContextCompatFieldHitStats();
  warnAgentContextCompatFieldOnce({
    field: "payload.tools.shared",
    replacement: "execution.controllers.runtime.sharedTools",
  });
  warnAgentContextCompatFieldOnce({
    field: "payload.tools.shared",
    replacement: "execution.controllers.runtime.sharedTools",
  });
  warnAgentContextCompatFieldOnce({
    field: "legacy.example.field",
    replacement: "canonical.example.field",
  });

  const stats = getAgentContextCompatFieldHitStats();
  assert.equal(stats["payload.tools.shared"], 2);
  assert.equal(stats["legacy.example.field"], 1);
});
