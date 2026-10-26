/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

export function makeRuntimeStep({ item, workflowPayload }) {
  return { ...item, rootSessionId: workflowPayload.value.runMeta.sessionId };
}

export function firstRuntimeStep(actionNodeStates) {
  return actionNodeStates[0].steps[0];
}
