/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
export const UNUSED_VARS_RULE_ID = "unused-imports/no-unused-vars";
export const UNUSED_VARS_OPTIONS = Object.freeze({
  vars: "all",
  args: "after-used",
  ignoreRestSiblings: true,
  caughtErrors: "all",
});
export const UNUSED_PARAMETER_OPTIONS = Object.freeze({ ...UNUSED_VARS_OPTIONS, args: "all" });
