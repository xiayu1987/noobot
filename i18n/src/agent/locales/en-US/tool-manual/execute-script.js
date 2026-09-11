/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

export const EXECUTE_SCRIPT_MANUAL = {
  execute_script: {
    summary:
      "Run a shell script under the current execution isolation view, for work that genuinely needs a command line.",
    usage: ["execute_script({ command, riskLevel, executionMode, includeLineNumbers })"],
    params: {
      command: "Shell command. Must use the syntax of the interpreter declared by the runtime.",
      riskLevel:
        "Script risk level: low, medium, high, or critical. Destructive scripts must be marked critical.",
      executionMode:
        "foreground returns stdout and stderr directly; background also waits for completion but stores output as an attachment and returns its path.",
      includeLineNumbers: "Whether output carries line numbers, off by default.",
    },
    notes: [
      "Do not replace dedicated tools with commands: read with read_file, edit with patch_file, search with search.",
      "Use paths relative to the current working directory; the interpreter and working directory come from the runtime environment section.",
      "background does not return early, and the command must not use background operators, nohup, or disown.",
      "Builds, tests, lint, and type checks are the main use here; run them right after changing code.",
    ],
    pitfalls: [
      "Destructive work must declare its real risk level. High risk is blocked by default and cannot be silently downgraded.",
      "Recursive deletes, bulk overwrites, and production config changes need user confirmation first.",
      "Quote and escape externally sourced values when composing commands, to prevent command injection.",
    ],
  },
};
