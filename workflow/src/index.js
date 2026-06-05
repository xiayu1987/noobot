/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { compileWorkflowSemantic } from "./lib/compiler.js";
import {
  startWorkflowInstance,
  advanceWorkflowInstance,
  executeWorkflowSemantic,
  startWorkflowInstanceById,
  getWorkflowInstanceSnapshot,
  resolveWorkflowUpstreamActionNodes,
  resolveWorkflowUpstreamActionSteps,
  advanceWorkflowInstanceById,
  releaseWorkflowInstance,
} from "./lib/runtime.js";

export {
  compileWorkflowSemantic,
  startWorkflowInstance,
  advanceWorkflowInstance,
  executeWorkflowSemantic,
  startWorkflowInstanceById,
  getWorkflowInstanceSnapshot,
  resolveWorkflowUpstreamActionNodes,
  resolveWorkflowUpstreamActionSteps,
  advanceWorkflowInstanceById,
  releaseWorkflowInstance,
};

export default {
  compileWorkflowSemantic,
  startWorkflowInstance,
  advanceWorkflowInstance,
  executeWorkflowSemantic,
  startWorkflowInstanceById,
  getWorkflowInstanceSnapshot,
  resolveWorkflowUpstreamActionNodes,
  resolveWorkflowUpstreamActionSteps,
  advanceWorkflowInstanceById,
  releaseWorkflowInstance,
};
