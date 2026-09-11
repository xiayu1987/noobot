/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

export const TASK_ORCHESTRATION_MANUAL = {
  task_summary: {
    summary:
      "Submit a stage summary for the current task, which becomes the authoritative stage state for later steps.",
    usage: ["task_summary({ summaryContent })"],
    params: {
      summaryContent: "Summary body strictly following the NOOBOT_TASK_SUMMARY/1 text protocol.",
    },
    protocol: [
      "The first line is exactly NOOBOT_TASK_SUMMARY/1.",
      "Exactly four sections in order: [STATE], [ABSTRACT], [DETAILS], [NEXT_ACTION].",
      "STATE must be CONTINUE, COMPLETE, or BLOCKED.",
      "ABSTRACT holds a short factual summary of the finished stage.",
      "DETAILS holds the authoritative stage state after merging earlier summaries, separating done work, key results, remaining work, and blockers; in programming mode it must carry file paths, function names, and line numbers.",
      "NEXT_ACTION holds the single unfinished action to perform next.",
      "All sections must be non-empty; do not add, repeat, or reorder sections.",
    ],
    notes: [
      "Call it only when the system asks for a stage summary; do not initiate one.",
      "The receipt is the authoritative stage state: finished work must not be redone, and after CONTINUE you resume only from NEXT_ACTION.",
      "Full content goes through summaryContent; the tool result returns only a derived receipt and attachment reference.",
    ],
    pitfalls: [
      "COMPLETE means the task is done and the next reply is a final answer without tools; BLOCKED means work cannot continue and the next reply explains the blocker without tools. Neither is interchangeable with CONTINUE.",
      "Missing sections, wrong order, or extra sections fail protocol validation.",
    ],
  },
  task_check: {
    summary: "Submit a task check slice recording current progress and the next step.",
    usage: ["task_check({ checkContent })"],
    params: {
      checkContent: "Check body strictly following the NOOBOT_TASK_CHECK/1 text protocol.",
    },
    protocol: [
      "The first line is exactly NOOBOT_TASK_CHECK/1.",
      "Exactly four sections in order: [STATE], [ABSTRACT], [DETAILS], [NEXT_ACTION].",
      "STATE must be CONTINUE, COMPLETE, or BLOCKED.",
      "ABSTRACT holds a short check summary; DETAILS holds the current goal, progress, drift risk, and gaps; NEXT_ACTION holds a concrete next action.",
      "All sections must be non-empty; do not add, repeat, or reorder sections.",
    ],
    notes: [
      "Call it as needed when the system emits a periodic task check prompt; it is not mandatory.",
      "This tool creates no summary marker or attachment; the result is only a derived receipt.",
    ],
    pitfalls: [
      "Its protocol header differs from task_summary, and the two must not be swapped.",
    ],
  },
};
