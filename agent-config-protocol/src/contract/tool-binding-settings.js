/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { createToolNameBinding, requireToolBindingConfig } from "@noobot/model-protocol";

export function resolveToolBindingSettings({ toolIds = [], bindings = {} } = {}, overrides = {}) {
  requireToolBindingConfig(bindings);
  requireToolBindingConfig(overrides);
  const effective = { ...bindings, ...overrides };
  const ids = new Set([...toolIds, ...Object.keys(effective)]);
  createToolNameBinding({
    bindings: effective,
    tools: [...ids].map((name) => ({ name })),
  });
  return effective;
}
