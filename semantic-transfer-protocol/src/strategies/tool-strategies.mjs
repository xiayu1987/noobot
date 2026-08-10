/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

export const TOOL_STRATEGIES = Object.freeze({
  INPUT: "tool_input",
  OUTPUT: "tool_output",
  RESULT_TEXT: "tool_result_text",
});

export const TOOL_SCENARIO = Object.freeze({
  name: "tool",
  strategies: Object.freeze(Object.values(TOOL_STRATEGIES)),
  categories: Object.freeze({}),
});
