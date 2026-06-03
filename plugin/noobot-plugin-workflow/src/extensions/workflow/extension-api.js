/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import {
  ModelBoxFactory,
  FlowtoBox,
  registerModelBoxFactory,
} from "workflow/extension";

let cached = null;

function assertFn(name = "", value = null) {
  if (typeof value !== "function") {
    throw new Error(`invalid workflow extension api: ${String(name || "").trim()} must be a function`);
  }
}

export function getWorkflowExtensionApi() {
  if (cached) return cached;
  const normalized = {
    ModelBoxFactory,
    FlowtoBox,
    registerModelBoxFactory,
  };
  assertFn("ModelBoxFactory", normalized.ModelBoxFactory);
  assertFn("FlowtoBox", normalized.FlowtoBox);
  assertFn("registerModelBoxFactory", normalized.registerModelBoxFactory);
  cached = normalized;
  return cached;
}
