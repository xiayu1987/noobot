/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import { HOOK_POINT } from "@noobot/hook-protocol";

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
  WORKFLOW_PLUGIN_DEFAULTS,
  resolveWorkflowNodeDialogProcessId,
  collectWorkflowDialogProcessIds,
  resolveWorkflowDialogProcessId,
} from "../helpers/workflow-hook-session-strategy-helper.js";

test("workflow dialog process helpers read only canonical identity fields", () => {
  assert.equal(resolveWorkflowDialogProcessId({ dialogProcessId: "dialog" }), "dialog");
  assert.equal(resolveWorkflowDialogProcessId({}), "");
  assert.deepEqual(
    collectWorkflowDialogProcessIds({ dialogProcessId: "dialog-a" }, { dialogProcessId: "dialog-b" }),
    ["dialog-a", "dialog-b"],
  );
  assert.equal(resolveWorkflowNodeDialogProcessId({ nodeDialogProcessId: "node-dialog" }), "node-dialog");
  assert.equal(resolveWorkflowNodeDialogProcessId({}), "");
});
