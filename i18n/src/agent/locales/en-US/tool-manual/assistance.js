/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

export const ASSISTANCE_TOOL_MANUAL = {
  final_answer: {
    summary: "Mark the current reply as the final answer and exit the tool-call loop.",
    usage: ["final_answer({ reason })"],
    params: { reason: "Optional reason for finalizing." },
    notes: [
      "Used with forced tool-choice mechanism; after calling, the next turn disables tools.",
      "This is not exiting the conversation, but exiting the current tool-call loop.",
    ],
    pitfalls: ["Do not call when tool operations are still needed; it will terminate prematurely."],
  },
};
