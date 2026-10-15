/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { ModelBoxFactory, FlowtoBox, registerModelBoxFactory } from "workflow/extension";
import { text } from "@noobot/shared/value";

let cached = null;

function assertFn(name = "", value = null) {
  if (typeof value !== "function") {
    throw new Error(`invalid workflow extension api: ${text(name)} must be a function`);
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
