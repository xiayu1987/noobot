/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { parseArgs } from "node:util";

export const OUTPUT_FORMATS = Object.freeze(["text", "json", "stream-json"]);
export const CONFIRMATION_LEVELS = Object.freeze(["low", "medium", "high", "critical"]);

const OPTIONS = Object.freeze({
  print: { type: "string", short: "p" },
  file: { type: "string", short: "f", multiple: true },
  resume: { type: "string", short: "r" },
  continue: { type: "boolean", short: "c" },
  user: { type: "string", short: "u" },
  "output-format": { type: "string", short: "o", default: "text" },
  "output-last-message": { type: "string" },
  scenario: { type: "string" },
  model: { type: "string", short: "m" },
  "memory-model": { type: "string" },
  plugin: { type: "string", multiple: true },
  "plugin-model": { type: "string", multiple: true },
  connector: { type: "string", multiple: true },
  "confirm-level": { type: "string" },
  "safe-confirm": { type: "boolean", default: true },
  interaction: { type: "boolean" },
  sanitize: { type: "boolean", default: true },
  stream: { type: "boolean", default: true },
  locale: { type: "string" },
  "summary-loop": { type: "string" },
  "task-check-loop": { type: "string" },
  dialog: { type: "string" },
  turn: { type: "string" },
  help: { type: "boolean", short: "h" },
});

export class CliUsageError extends Error {
  constructor(message) {
    super(message);
    this.name = "CliUsageError";
  }
}

function positiveInteger(value, name) {
  if (value === undefined) return undefined;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new CliUsageError(`--${name} must be a positive integer`);
  }
  return parsed;
}

function parsePluginModelConfig(entries = []) {
  if (!entries.length) return undefined;
  const config = {};
  for (const entry of entries) {
    const separator = entry.indexOf("=");
    if (separator <= 0) throw new CliUsageError("--plugin-model expects <plugin>=<json>");
    let value;
    try {
      value = JSON.parse(entry.slice(separator + 1));
    } catch {
      throw new CliUsageError("--plugin-model value must be valid JSON");
    }
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new CliUsageError("--plugin-model value must be a JSON object");
    }
    config[entry.slice(0, separator).trim()] = value;
  }
  return config;
}

export const CLI_ACTION = Object.freeze({
  SEND: "send",
  RESUME_TURN: "resume-turn",
  SESSIONS: "sessions",
  HELP: "help",
});

const SUBCOMMANDS = new Set([CLI_ACTION.RESUME_TURN, CLI_ACTION.SESSIONS]);

function resolveAction(values, positionals) {
  if (values.help) return { action: CLI_ACTION.HELP, rest: positionals };
  if (SUBCOMMANDS.has(positionals[0]))
    return { action: positionals[0], rest: positionals.slice(1) };
  return { action: CLI_ACTION.SEND, rest: positionals };
}

function buildPreferences(values, { interactive }) {
  const confirmationLevel = values["confirm-level"];
  if (confirmationLevel && !CONFIRMATION_LEVELS.includes(confirmationLevel)) {
    throw new CliUsageError(`--confirm-level must be one of ${CONFIRMATION_LEVELS.join("|")}`);
  }
  const summaryPolicy = {
    phaseSummaryLoopTurns: positiveInteger(values["summary-loop"], "summary-loop"),
    taskCheckLoopTurns: positiveInteger(values["task-check-loop"], "task-check-loop"),
  };
  return {
    allowUserInteraction: values.interaction ?? interactive,
    safeConfirm: values["safe-confirm"],
    sanitizeOutput: values.sanitize,
    streaming: values.stream,
    frontendThresholdsEnabled: false,
    ...(confirmationLevel ? { confirmationLevel } : {}),
    locale: values.locale || "",
    scenario: values.scenario || "",
    selectedModel: values.model || "",
    memoryModel: values["memory-model"] || "",
    selectedPlugins: values.plugin || [],
    pluginModelConfig: parsePluginModelConfig(values["plugin-model"]),
    summaryPolicy,
  };
}

function validateCombination(action, values) {
  if (values.resume && values.continue) {
    throw new CliUsageError("--resume and --continue are mutually exclusive");
  }
  if (
    values.connector?.length &&
    (values.resume || values.continue || action !== CLI_ACTION.SEND)
  ) {
    throw new CliUsageError("--connector is only allowed when creating a new session");
  }
  if (!OUTPUT_FORMATS.includes(values["output-format"])) {
    throw new CliUsageError(`--output-format must be one of ${OUTPUT_FORMATS.join("|")}`);
  }
  if (action === CLI_ACTION.RESUME_TURN) {
    if (!values.resume) throw new CliUsageError("resume-turn requires --resume");
    if (!values.dialog) throw new CliUsageError("resume-turn requires --dialog");
    if (!values.turn) throw new CliUsageError("resume-turn requires --turn");
  } else if (values.dialog || values.turn) {
    throw new CliUsageError("--dialog and --turn are only allowed with resume-turn");
  }
}

export function parseCliArgs(argv = [], { interactive = false } = {}) {
  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      options: OPTIONS,
      allowPositionals: true,
      allowNegative: true,
    });
  } catch (error) {
    throw new CliUsageError(error.message);
  }
  const { values, positionals } = parsed;
  const { action, rest } = resolveAction(values, positionals);
  if (action === CLI_ACTION.HELP) return { action };
  validateCombination(action, values);
  return {
    action,
    message: values.print ?? rest.join(" "),
    files: values.file || [],
    userId: values.user || "",
    outputFormat: values["output-format"],
    outputLastMessage: values["output-last-message"] || "",
    sessionId: values.resume || "",
    continueLatest: values.continue === true,
    dialogProcessId: values.dialog || "",
    turnScopeId: values.turn || "",
    selectedConnectorIds: values.connector || [],
    interactive,
    preferences: buildPreferences(values, { interactive }),
  };
}

export const CLI_USAGE = `Usage: noobot [options] [message]
       noobot resume-turn -r <sessionId> --dialog <dialogProcessId> --turn <turnScopeId> [message]
       noobot sessions [--user <id>]

Message is read from -p, positional args, or stdin when piped.

Options:
  -p, --print <text>            Non-interactive prompt
  -f, --file <path>             Attach a file (repeatable)
  -r, --resume <sessionId>      Continue an existing session
  -c, --continue                Continue the most recent session
  -u, --user <id>               Run as workspace user (default: configured super admin)
  -o, --output-format <fmt>     text | json | stream-json (default: text)
      --output-last-message <f> Write the final assistant message to a file
      --scenario <key>          Scenario key
  -m, --model <alias>           Model alias
      --memory-model <alias>    Memory model alias
      --plugin <key>            Enable plugin (repeatable)
      --plugin-model <k>=<json> Plugin model config (repeatable)
      --connector <id>          Connector for a new session (repeatable)
      --confirm-level <level>   ${CONFIRMATION_LEVELS.join(" | ")}
      --no-safe-confirm         Disable safe confirmation
      --[no-]interaction        Allow interaction requests (default: on for TTY)
      --no-sanitize             Disable output sanitization
      --no-stream               Disable model streaming
      --locale <tag>            Locale
      --summary-loop <n>        Phase summary loop turns
      --task-check-loop <n>     Task check loop turns
  -h, --help                    Show help

Exit codes: 0 done, 1 failed, 2 usage/protocol error, 3 interaction unavailable, 130 stopped`;
