/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { createToolNameBinding, requireToolBindingConfig } from "@noobot/model-protocol";
import { deepMerge } from "../utils.js";

export function projectToolBindingSettings({ bindings = {} } = {}, overrides) {
  return deepMerge({ bindings }, overrides === undefined ? {} : { bindings: overrides }).bindings;
}

export function resolveToolBindingSettings({ toolIds = [], bindings = {} } = {}, overrides = {}) {
  const effective = projectToolBindingSettings({ bindings }, overrides);
  requireToolBindingConfig(effective);
  const ids = new Set([...toolIds, ...Object.keys(effective)]);
  createToolNameBinding({
    bindings: effective,
    tools: [...ids].map((name) => ({ name })),
  });
  return effective;
}
