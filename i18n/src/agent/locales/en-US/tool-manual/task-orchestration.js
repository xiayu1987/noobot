/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

export const TASK_ORCHESTRATION_MANUAL = {
  task_check: {
    summary: "Submit a task check slice recording current progress and the next step.",
    usage: ["{{tool:task_check}}({ checkContent })"],
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
      "Call it as needed after a periodic task-check prompt; it is optional.",
      "This tool creates no summary marker or attachment; the result is only a derived receipt.",
    ],
  },
};
