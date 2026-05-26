/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";

import { resolveCapabilityModelMessages } from "../src/capabilities/handlers/shared/model-utils.js";
import { buildHarnessInjectedMessage } from "../src/capabilities/handlers/shared/injected-message-utils.js";
import { resolveDialogProcessIdFromContext } from "../src/capabilities/handlers/shared/dialog-process-id.js";

test("resolveCapabilityModelMessages respects empty array from resolver", () => {
  const result = resolveCapabilityModelMessages(
    {
      harness: {
        resolveModelMessages: () => [],
      },
    },
    {
      messages: [{ role: "user", content: "should-not-fallback" }],
    },
  );
  assert.deepEqual(result, []);
});

test("buildHarnessInjectedMessage includes dialogProcessId when provided", () => {
  const message = buildHarnessInjectedMessage("relay text", {
    dialogProcessId: "dlg_1",
  });
  assert.equal(message.role, "user");
  assert.equal(message.injectedMessage, true);
  assert.equal(message.injectedBy, "harness-plugin");
  assert.equal(message.dialogProcessId, "dlg_1");
});

test("resolveDialogProcessIdFromContext reads nested execution dialogProcessId", () => {
  const dialogProcessId = resolveDialogProcessIdFromContext({
    agentContext: {
      execution: {
        dialogProcessId: "dlg_nested",
      },
    },
  });
  assert.equal(dialogProcessId, "dlg_nested");
});
