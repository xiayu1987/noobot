/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";

import { createWorkflowExtensionRuntime } from "../src/extensions/workflow/runtime.js";

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

test("workflow extension runtime supports plugin-side mounter and extension list", () => {
  const calls = [];
  const api = { registerModelBoxFactory() {} };
  const runtime = createWorkflowExtensionRuntime({
    getWorkflowExtensionApi: () => api,
    createDefaultWorkflowExtension: () =>
      function defaultExtension(ctx) {
        calls.push(["default", ctx.api === api]);
      },
  });

  runtime.mount({
    options: {
      workflowExtensionMounter(ctx) {
        calls.push(["mounter", ctx.api === api]);
      },
      workflowExtensions: [
        function customA(ctx) {
          calls.push(["customA", ctx.api === api]);
        },
        function customB(ctx) {
          calls.push(["customB", ctx.api === api]);
        },
      ],
    },
  });

  assert.deepEqual(calls, [
    ["mounter", true],
    ["default", true],
    ["customA", true],
    ["customB", true],
  ]);
});

