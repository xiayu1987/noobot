/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

export const TASK_ORCHESTRATION_TOOL_SCHEMA = {
  task_summary: {
    description: {
      key: "tools.task_summary.description",
      text: "Submit the current task phase summary only when requested by the system. summaryContent must strictly follow the single NOOBOT_TASK_SUMMARY/1 text protocol, with exactly [STATE], [ABSTRACT], [DETAILS], and [NEXT_ACTION] in that order. STATE must be CONTINUE, COMPLETE, or BLOCKED. The summary is the authoritative phase state for subsequent work: completed work must not be repeated, and CONTINUE resumes only from NEXT_ACTION. The complete content exists only in this input; the tool result returns only a derived receipt and attachment reference.",
    },
    params: {
      summaryContent: {
        key: "tools.task_summary.fieldSummaryContent",
        text: "Exact format: NOOBOT_TASK_SUMMARY/1\n[STATE]\nCONTINUE|COMPLETE|BLOCKED\n[ABSTRACT]\nShort factual summary of the completed phase\n[DETAILS]\nAuthoritative phase state integrated with prior summaries; clearly distinguish completed work, key results, remaining work, and blockers; in programming mode include file paths, function names, and line numbers\n[NEXT_ACTION]\nThe single specific unfinished action to execute next. CONTINUE resumes only from NEXT_ACTION and must not repeat work recorded as completed in ABSTRACT or DETAILS; COMPLETE enters a no-tools final response; BLOCKED enters a no-tools blocker explanation. Every section must be non-empty; do not add, repeat, or reorder sections.",
      },
    },
    texts: {
      "tools.task_summary.summaryContentRequired": "summaryContent is required",
      "tools.task_summary.summaryProtocolInvalid":
        "summaryContent does not conform to NOOBOT_TASK_SUMMARY/1",
      "tools.task_summary.summaryCompletedFollowState":
        "This summary receipt is the authoritative phase state. Do not repeat completed work; for CONTINUE, proceed only from summary.nextAction, and for COMPLETE or BLOCKED, finish according to that state.",
    },
  },
  task_check: {
    description: {
      key: "tools.task_check.description",
      text: "Submit a task-check slice when the system emits a periodic task-check prompt. Calling it is optional. checkContent must strictly follow the single NOOBOT_TASK_CHECK/1 text protocol with exactly [STATE], [ABSTRACT], [DETAILS], and [NEXT_ACTION] in that order. STATE must be CONTINUE, COMPLETE, or BLOCKED. This tool creates neither a summary marker nor an attachment; its result contains only a derived receipt.",
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
