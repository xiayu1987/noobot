/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { computed } from "vue";
import { selectTurnPresentations } from "./turnPresentation.js";

const sessions = new WeakMap();

export function selectSharedTurnPresentations({
  activeSession,
  workflowRegistry,
  turnRuntimeRegistry,
}) {
  let workflows = sessions.get(activeSession);
  if (!workflows) {
    workflows = new WeakMap();
    sessions.set(activeSession, workflows);
  }
  let runtimes = workflows.get(workflowRegistry);
  if (!runtimes) {
    runtimes = new WeakMap();
    workflows.set(workflowRegistry, runtimes);
  }
  let projection = runtimes.get(turnRuntimeRegistry);
  if (!projection) {
    projection = computed(() =>
      selectTurnPresentations({ activeSession, workflowRegistry, turnRuntimeRegistry }),
    );
    runtimes.set(turnRuntimeRegistry, projection);
  }
  return projection.value;
}
