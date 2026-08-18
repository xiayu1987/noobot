/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

export const WORKFLOW_STRATEGIES = Object.freeze({
  SUB_AGENT: "workflow_subagent",
  FINAL_PLAN: "workflow_final_plan",
});

export const WORKFLOW_SCENARIO = Object.freeze({
  name: "workflow",
  strategies: Object.freeze(Object.values(WORKFLOW_STRATEGIES)),
  categories: Object.freeze({
    main_agent: Object.freeze(["final_plan"]),
    sub_agent: Object.freeze(["delegation", "task_result"]),
  }),
});
