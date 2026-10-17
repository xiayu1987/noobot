/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";

import { createWorkflowExtensionRuntime } from "../../src/extensions/workflow/runtime.js";

test("workflow extension runtime mounts default extension once", () => {
  const calls = [];
  const runtime = createWorkflowExtensionRuntime({
    getWorkflowExtensionApi: () => ({ registerModelBoxFactory() {} }),
    createDefaultWorkflowExtension: () =>
      function defaultExtension() {
        calls.push("default");
      },
  });

  runtime.mount({ options: {} });
  runtime.mount({ options: {} });

  assert.deepEqual(calls, ["default"]);
});
