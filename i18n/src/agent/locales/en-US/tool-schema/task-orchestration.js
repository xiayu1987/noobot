/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

export const TASK_ORCHESTRATION_TOOL_SCHEMA = {
  task_check: {
    description: {
      key: "tools.task_check.description",
      text: "Submit a task-check slice. Call it as needed after a periodic task-check prompt; it is optional. checkContent must strictly follow the single NOOBOT_TASK_CHECK/1 text protocol with exactly [STATE], [ABSTRACT], [DETAILS], and [NEXT_ACTION] in that order. STATE must be CONTINUE, COMPLETE, or BLOCKED. This tool creates neither a summary marker nor an attachment; its result contains only a derived receipt.",
    },
    params: {
      checkContent: {
        key: "tools.task_check.fieldCheckContent",
        text: "Exact format: NOOBOT_TASK_CHECK/1\n[STATE]\nCONTINUE|COMPLETE|BLOCKED\n[ABSTRACT]\nShort task-check abstract\n[DETAILS]\nCurrent goal, progress, drift risks, and omissions\n[NEXT_ACTION]\nSpecific next action. Every section must be non-empty; do not add, repeat, or reorder sections.",
      },
    },
    texts: {
      "tools.task_check.checkContentRequired": "checkContent is required",
      "tools.task_check.checkProtocolInvalid":
        "checkContent does not conform to NOOBOT_TASK_CHECK/1",
      "tools.task_check.completed":
        "Task check recorded. Continue according to its state, abstract, and next action.",
    },
  },
  list_skills: {
    description: {
      key: "tools.skill.listDescription",
      text: "List skill directory structure. Input parentSkill (optional). Returns directory hierarchy items.",
    },
    params: {
      parentSkill: {
        key: "tools.skill.fieldParentSkill",
        text: "Skill subpath (optional).",
      },
    },
    texts: {},
  },
};
