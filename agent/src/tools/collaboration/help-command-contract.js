/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

export const HELP_COMMAND = Object.freeze({
  TOOLS: "tools",
  MODELS: "models",
  EXPERIENCE: "experience",
  MEMORY: "memory",
  RUNTIME: "runtime",
  CONTEXT: "context",
  ATTACHS: "attachs",
  ISOLATION: "isolation",
});

export const HELP_OPTION = Object.freeze({
  NAME: "name",
  ID: "id",
  SOURCE: "source",
});

export const HELP_COMMAND_OPTIONS = Object.freeze({
  [HELP_COMMAND.TOOLS]: Object.freeze([HELP_OPTION.NAME]),
  [HELP_COMMAND.MODELS]: Object.freeze([]),
  [HELP_COMMAND.EXPERIENCE]: Object.freeze([]),
  [HELP_COMMAND.MEMORY]: Object.freeze([]),
  [HELP_COMMAND.RUNTIME]: Object.freeze([]),
  [HELP_COMMAND.CONTEXT]: Object.freeze([]),
  [HELP_COMMAND.ATTACHS]: Object.freeze([HELP_OPTION.ID, HELP_OPTION.SOURCE]),
  [HELP_COMMAND.ISOLATION]: Object.freeze([]),
});

export const HELP_COMMAND_NAMES = Object.freeze(Object.values(HELP_COMMAND));

export const HELP_COMMAND_USAGE = Object.freeze([
  "help()",
  "help({ command: '--tools' })",
  "help({ command: '--tools --name read_file' })",
  "help({ command: '--models' })",
  "help({ command: '--experience' })",
  "help({ command: '--memory' })",
  "help({ command: '--runtime' })",
  "help({ command: '--context' })",
  "help({ command: '--attachs' })",
  "help({ command: '--attachs --id <attachmentId>' })",
  "help({ command: '--attachs --source model' })",
  "help({ command: '--isolation' })",
]);
