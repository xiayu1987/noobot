/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { LOCALE } from "./locale.js";

// Defaults (non-UI runtime fallback values)
export const DEFAULT_TASK_OWNER = Object.freeze({
  [LOCALE.ZH_CN]: "primary_task_owner",
  [LOCALE.EN_US]: "primary_task_owner",
});

export const DEFAULT_SUBTASK_OWNERS = Object.freeze({
  [LOCALE.ZH_CN]: ["subtask_owner_alpha", "subtask_owner_beta"],
  [LOCALE.EN_US]: ["subtask_owner_alpha", "subtask_owner_beta"],
});

export const DEFAULT_TASK_TEMPLATE = Object.freeze({
  [LOCALE.ZH_CN]: Object.freeze({
    PARSE_ATTACHMENT: "解析附件",
    EXECUTE_CORE: "执行核心任务",
    START_SUBTASK: "开启子任务",
    WAIT_SUBTASK_RESULT: "等待子任务结果",
  }),
  [LOCALE.EN_US]: Object.freeze({
    PARSE_ATTACHMENT: "Parse attachments",
    EXECUTE_CORE: "Execute core task",
    START_SUBTASK: "Start subtasks",
    WAIT_SUBTASK_RESULT: "Wait for subtask results",
  }),
});

// Prompt JSON schema examples
export const PROMPT_JSON_FORMAT_EXAMPLES = Object.freeze({
  planning_main:
    '{"totalGoal":"...","taskOwner":"...","nextPhase":{"objective":"...","checklistIndexes":[1]},"taskChecklist":[{"index":1,"task":"...","owner":"...","subOwners":[],"input":"...","output":"...","files":{"create":[],"modify":[],"delete":[]}}]}',
  planning_revision:
    '{"totalGoal":"...","taskOwner":"...","nextPhase":{"objective":"...","checklistIndexes":[1]},"taskChecklist":[{"index":1,"task":"...","owner":"...","subOwners":[],"input":"...","output":"...","files":{"create":[],"modify":[],"delete":[]}}]}',
  planning_refinement:
    '{"stage":"refinement","totalGoal":"...","taskOwner":"...","nextPhase":{"objective":"...","checklistIndexes":[1]},"refinementChecklist":[{"index":101,"mainStepIndex":1,"isMainStep":false,"task":"...","owner":"...","subOwners":[],"input":"...","output":"...","files":{"create":[],"modify":[],"delete":[]}}]}',
  acceptance_semantic_validation:
    '{"status":"pass|warn|fail","consistent":true,"missingItems":[],"unsupportedClaims":[],"checklistCoverage":[{"index":1,"task":"...","covered":true,"evidence":"...","risk":"low"}],"suggestions":[]}',
});
