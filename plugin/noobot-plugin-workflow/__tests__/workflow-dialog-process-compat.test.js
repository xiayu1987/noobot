/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";

import {
  createMockBotHookManager,
  workflowDsl,
  simpleActionWorkflowDsl,
  createCapabilityModelInvoker,
  createNodeResult,
  createRecordingSubSessionRunner,
  createAttachmentPersister,
  createSemanticTransferTool,
  createBaseContext,
  createContextWithSharedTools,
  getBeforeDispatch,
  runWorkflowHook,
  callsByNodeName,
  workflowTurn,
  createRegisterWorkflowHooks,
  WORKFLOW_BOT_HOOK_POINTS,
  WORKFLOW_PLUGIN_DEFAULTS,
  resolveWorkflowNodeDialogProcessId,
  collectWorkflowDialogProcessIds,
  resolveWorkflowDialogProcessId,
} from "./helpers/workflow-hook-session-strategy-helper.js";

test("workflow dialog process compat helpers keep old dialog fields read-only", () => {
  assert.equal(resolveWorkflowDialogProcessId({ dialogProcessId: "new-dialog" }), "new-dialog");
  assert.equal(resolveWorkflowDialogProcessId({ dialogId: "legacy-dialog" }), "legacy-dialog");
  assert.equal(resolveWorkflowDialogProcessId({ nodeDialogId: "legacy-node-dialog" }), "legacy-node-dialog");
  assert.equal(
    resolveWorkflowDialogProcessId({}, { dialogId: "fallback-dialog" }),
    "fallback-dialog",
  );
  assert.deepEqual(
    collectWorkflowDialogProcessIds({ dialogProcessId: "new-dialog" }, { dialogId: "legacy-dialog" }),
    ["new-dialog", "legacy-dialog"],
  );
  assert.equal(resolveWorkflowNodeDialogProcessId({ nodeDialogProcessId: "new-node-dialog" }), "new-node-dialog");
  assert.equal(resolveWorkflowNodeDialogProcessId({ nodeDialogId: "legacy-node-dialog" }), "legacy-node-dialog");
});
