/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { shallowRef } from "vue";
import { diagnoseToolBindingConfig, resolveToolBindingName } from "@noobot/model-protocol";

const current = shallowRef(null);

export function setToolNameBindings(userId, bindings) {
  if (!userId) throw new TypeError("tool name bindings require a user identity");
  if (bindings === undefined) throw new TypeError("connection.toolNameBindings is required");
  current.value = {
    userId,
    bindings: JSON.parse(JSON.stringify(bindings)),
    issues: diagnoseToolBindingConfig(bindings),
  };
}

export function clearToolNameBindings() {
  current.value = null;
}

export function updateToolNameBindings(userId, bindings) {
  if (current.value?.userId !== userId) return;
  setToolNameBindings(userId, bindings);
}

export function toolDisplayName(toolId) {
  if (!toolId) return "";
  if (current.value?.issues.length) return `${toolId} (${current.value.issues[0].code})`;
  return resolveToolBindingName(toolId, current.value?.bindings);
}
