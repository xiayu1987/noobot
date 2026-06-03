/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

module.exports = {
  // Stable facade API (recommended for integrations/plugins)
  compileWorkflowSemantic: require("./lib/compiler").compileWorkflowSemantic,
  startWorkflowInstance: require("./lib/runtime").startWorkflowInstance,
  advanceWorkflowInstance: require("./lib/runtime").advanceWorkflowInstance,
  executeWorkflowSemantic: require("./lib/runtime").executeWorkflowSemantic,
};
