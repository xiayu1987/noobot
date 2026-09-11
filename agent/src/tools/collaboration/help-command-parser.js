/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { parseArgs } from "node:util";
import { HELP_COMMAND_NAMES, HELP_COMMAND_OPTIONS, HELP_OPTION } from "./help-command-contract.js";

const ALL_OPTION_NAMES = Object.freeze(Object.values(HELP_OPTION));

const PARSE_OPTION_CONFIG = Object.freeze(
  Object.fromEntries(ALL_OPTION_NAMES.map((name) => [name, { type: "string" }])),
);

const EMPTY_OPTIONS = Object.freeze({});

export const HELP_PARSE_ERROR = Object.freeze({
  UNKNOWN_COMMAND: "unknown_command",
  MULTIPLE_COMMANDS: "multiple_commands",
  UNKNOWN_OPTION: "unknown_option",
  OPTION_NOT_SUPPORTED: "option_not_supported",
  MALFORMED: "malformed",
});

function tokenize(command = "") {
  return String(command || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

function failure(reason, details = {}) {
  return Object.freeze({ ok: false, reason, ...details });
}

export function parseHelpCommand(command = "") {
  const tokens = tokenize(command);
  if (!tokens.length) {
    return Object.freeze({ ok: true, command: "", options: EMPTY_OPTIONS });
  }

  const commandTokens = tokens.filter(
    (token) => token.startsWith("--") && HELP_COMMAND_NAMES.includes(token.slice(2)),
  );
  if (commandTokens.length > 1) {
    return failure(HELP_PARSE_ERROR.MULTIPLE_COMMANDS, {
      commands: commandTokens.map((token) => token.slice(2)),
    });
  }

  const [head, ...rest] = tokens;
  if (!head.startsWith("--")) {
    return failure(HELP_PARSE_ERROR.MALFORMED, { token: head });
  }
  const commandName = head.slice(2);
  if (!HELP_COMMAND_NAMES.includes(commandName)) {
    return failure(HELP_PARSE_ERROR.UNKNOWN_COMMAND, { command: commandName });
  }

  let parsed;
  try {
    parsed = parseArgs({
      args: rest,
      options: PARSE_OPTION_CONFIG,
      strict: true,
      allowPositionals: false,
    });
  } catch (error) {
    const token = String(error?.message || "").match(/'(--[^']+)'/)?.[1] || "";
    if (token) {
      return failure(HELP_PARSE_ERROR.UNKNOWN_OPTION, { option: token.replace(/^--/, "") });
    }
    return failure(HELP_PARSE_ERROR.MALFORMED, { token: rest.join(" ") });
  }

  const allowedOptions = HELP_COMMAND_OPTIONS[commandName] || [];
  const usedOptions = Object.keys(parsed.values);
  const rejected = usedOptions.find((name) => !allowedOptions.includes(name));
  if (rejected) {
    return failure(HELP_PARSE_ERROR.OPTION_NOT_SUPPORTED, {
      command: commandName,
      option: rejected,
      allowedOptions: [...allowedOptions],
    });
  }

  return Object.freeze({
    ok: true,
    command: commandName,
    options: Object.freeze({ ...parsed.values }),
  });
}
