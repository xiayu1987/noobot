/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  AGENT_COMMAND,
  AGENT_COMMAND_TYPES,
  AGENT_TRANSPORT_PROTOCOL_VERSION,
  EXECUTION_QUERY_COMMAND_TYPES,
  RUN_COMMAND_TYPES,
} from "./constants.js";
import { createRunPreferences, validateRunPreferences } from "./run-preferences.js";

const COMMAND_TYPE_SET = new Set(AGENT_COMMAND_TYPES);
const RUN_COMMAND_SET = new Set(RUN_COMMAND_TYPES);
const EXECUTION_QUERY_SET = new Set(EXECUTION_QUERY_COMMAND_TYPES);
const TOP_LEVEL_KEYS = new Set([
  "protocolVersion",
  "commandType",
  "commandId",
  "identity",
  "input",
  "preferences",
  "presentation",
  "concurrency",
  "session",
  "continuation",
  "stop",
  "interaction",
  "query",
  "options",
]);
const BASE_COMMAND_KEYS = ["protocolVersion", "commandType", "commandId", "identity"];
const IDENTITY_KEYS = new Set([
  "sessionId",
  "parentSessionId",
  "dialogProcessId",
  "parentDialogProcessId",
  "turnScopeId",
]);
const INPUT_KEYS = new Set(["message", "attachments"]);
const PRESENTATION_KEYS = new Set(["userMessageId", "assistantMessageId"]);
const RUN_CONCURRENCY_KEYS = new Set(["expectedTurnRevision", "expectedAggregateVersion"]);
const STOP_CONCURRENCY_KEYS = new Set(["expectedTurnRevision"]);
const SESSION_KEYS = new Set(["createIfAbsent"]);
const CONTINUATION_KEYS = new Set(["dialogProcessId", "turnScopeId"]);
const STOP_KEYS = new Set(["executionId", "partialAssistant"]);
const PARTIAL_ASSISTANT_KEYS = new Set([
  "content",
  "dialogProcessId",
  "turnScopeId",
  "createdAtMs",
  "modelAlias",
  "modelName",
]);
const INTERACTION_KEYS = new Set(["requestId", "response"]);
const QUERY_KEYS = new Set(["executionId", "rootExecutionId"]);
const SNAPSHOT_OPTION_KEYS = new Set(["knownSequence", "terminalLimit"]);
const FINALIZE_OPTION_KEYS = new Set(["terminalLimit"]);

const clean = (value) => String(value ?? "").trim();
const isObject = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);

function compactObject(source = {}) {
  return Object.fromEntries(
    Object.entries(source).filter(([, value]) => value !== undefined && value !== ""),
  );
}

function createIdentity(input = {}) {
  return compactObject({
    sessionId: clean(input.sessionId),
    parentSessionId: clean(input.parentSessionId),
    dialogProcessId: clean(input.dialogProcessId),
    parentDialogProcessId: clean(input.parentDialogProcessId),
    turnScopeId: clean(input.turnScopeId),
  });
}

function createEnvelope(commandType, input = {}) {
  return {
    protocolVersion: AGENT_TRANSPORT_PROTOCOL_VERSION,
    commandType,
    commandId: clean(input.commandId),
    identity: createIdentity(input.identity),
  };
}

export function createTurnRunCommand(input = {}) {
  const commandType = clean(input.commandType).toLowerCase();
  if (!RUN_COMMAND_SET.has(commandType)) throw new TypeError("invalid_run_command_type");
  return {
    ...createEnvelope(commandType, input),
    input: {
      message: String(input.input?.message ?? ""),
      attachments: Array.isArray(input.input?.attachments) ? input.input.attachments : [],
    },
    preferences: createRunPreferences(input.preferences),
    presentation: compactObject({
      userMessageId: clean(input.presentation?.userMessageId),
      assistantMessageId: clean(input.presentation?.assistantMessageId),
    }),
    concurrency: compactObject({
      expectedTurnRevision: input.concurrency?.expectedTurnRevision ?? 0,
      expectedAggregateVersion: input.concurrency?.expectedAggregateVersion ?? 0,
    }),
    session: {
      createIfAbsent: input.session?.createIfAbsent === true,
    },
    ...(commandType === AGENT_COMMAND.CONTINUE
      ? {
          continuation: {
            dialogProcessId: clean(input.continuation?.dialogProcessId),
            turnScopeId: clean(input.continuation?.turnScopeId),
          },
        }
      : {}),
  };
}

export function createTurnStopCommand(input = {}) {
  const expectedTurnRevision = input.concurrency?.expectedTurnRevision;
  if (!Number.isInteger(expectedTurnRevision) || expectedTurnRevision < 1) {
    throw new TypeError("invalid_expected_turn_revision");
  }
  return {
    ...createEnvelope(AGENT_COMMAND.STOP, input),
    concurrency: { expectedTurnRevision },
    stop: compactObject({
      executionId: clean(input.stop?.executionId),
      partialAssistant: isObject(input.stop?.partialAssistant)
        ? { ...input.stop.partialAssistant }
        : undefined,
    }),
  };
}

export function createInteractionResponseCommand(input = {}) {
  return {
    ...createEnvelope(AGENT_COMMAND.INTERACTION_RESPONSE, input),
    interaction: {
      requestId: clean(input.interaction?.requestId),
      response: input.interaction?.response ?? {},
    },
  };
}

export function createExecutionQueryCommand(input = {}) {
  const commandType = clean(input.commandType).toLowerCase();
  if (!EXECUTION_QUERY_SET.has(commandType))
    throw new TypeError("invalid_execution_query_command_type");
  return {
    ...createEnvelope(commandType, input),
    query: compactObject({
      executionId: clean(input.query?.executionId),
      rootExecutionId: clean(input.query?.rootExecutionId),
    }),
  };
}

export function createTurnSnapshotCommand(input = {}) {
  return {
    ...createEnvelope(AGENT_COMMAND.TURN_SNAPSHOT_GET, input),
    options: compactObject({
      knownSequence: input.options?.knownSequence,
      terminalLimit: input.options?.terminalLimit,
    }),
  };
}

export function createTurnFinalizeCommand(input = {}) {
  return {
    ...createEnvelope(AGENT_COMMAND.FINALIZE, input),
    options: compactObject({ terminalLimit: input.options?.terminalLimit }),
  };
}

function validateIdentity(command, errors) {
  if (!isObject(command.identity)) {
    errors.push("identity_not_object");
    return;
  }
  rejectUnknownFields(command.identity, IDENTITY_KEYS, "identity", errors);
  if (!clean(command.identity.sessionId)) errors.push("missing_session_id");
}

function rejectUnknownFields(value, allowedKeys, path, errors) {
  if (!isObject(value)) return;
  for (const key of Object.keys(value)) {
    if (!allowedKeys.has(key)) errors.push(`unknown_${path}_field:${key}`);
  }
}

function validateTopLevelFields(command, commandType, errors) {
  const commandKeys = RUN_COMMAND_SET.has(commandType)
    ? [
        ...BASE_COMMAND_KEYS,
        "input",
        "preferences",
        "presentation",
        "concurrency",
        "session",
        ...(commandType === AGENT_COMMAND.CONTINUE ? ["continuation"] : []),
      ]
    : commandType === AGENT_COMMAND.STOP
      ? [...BASE_COMMAND_KEYS, "concurrency", "stop"]
      : commandType === AGENT_COMMAND.INTERACTION_RESPONSE
        ? [...BASE_COMMAND_KEYS, "interaction"]
        : EXECUTION_QUERY_SET.has(commandType)
          ? [...BASE_COMMAND_KEYS, "query"]
          : commandType === AGENT_COMMAND.TURN_SNAPSHOT_GET ||
              commandType === AGENT_COMMAND.FINALIZE
            ? [...BASE_COMMAND_KEYS, "options"]
            : [...BASE_COMMAND_KEYS];
  const allowedKeys = new Set(commandKeys);
  for (const key of Object.keys(command)) {
    if (!TOP_LEVEL_KEYS.has(key)) errors.push(`unknown_top_level_field:${key}`);
    else if (!allowedKeys.has(key)) errors.push(`unexpected_top_level_field:${key}`);
  }
}

export function validateAgentCommand(command) {
  const errors = [];
  if (!isObject(command)) return { valid: false, errors: ["command_not_object"] };
  if (Number(command.protocolVersion) !== AGENT_TRANSPORT_PROTOCOL_VERSION)
    errors.push("unsupported_protocol_version");
  const commandType = clean(command.commandType).toLowerCase();
  if (!COMMAND_TYPE_SET.has(commandType)) errors.push("unsupported_command_type");
  if (!clean(command.commandId)) errors.push("missing_command_id");
  validateTopLevelFields(command, commandType, errors);
  validateIdentity(command, errors);

  if (RUN_COMMAND_SET.has(commandType)) {
    if (!clean(command.identity?.turnScopeId)) errors.push("missing_turn_scope_id");
    if (commandType === AGENT_COMMAND.RESEND && !clean(command.identity?.dialogProcessId)) {
      errors.push("missing_resend_dialog_process_id");
    }
    if (!isObject(command.input)) errors.push("input_not_object");
    else {
      rejectUnknownFields(command.input, INPUT_KEYS, "input", errors);
      if (!clean(command.input.message)) errors.push("missing_message");
      if (!Array.isArray(command.input.attachments)) errors.push("invalid_attachments");
    }
    errors.push(...validateRunPreferences(command.preferences).errors);
    if (!isObject(command.presentation)) errors.push("presentation_not_object");
    else rejectUnknownFields(command.presentation, PRESENTATION_KEYS, "presentation", errors);
    if (!isObject(command.concurrency)) errors.push("concurrency_not_object");
    else {
      rejectUnknownFields(command.concurrency, RUN_CONCURRENCY_KEYS, "concurrency", errors);
      if (command.concurrency.expectedTurnRevision !== 0)
        errors.push("run_turn_revision_must_be_zero");
      if (
        !Number.isInteger(command.concurrency.expectedAggregateVersion) ||
        command.concurrency.expectedAggregateVersion < 0
      ) {
        errors.push("invalid_expected_session_version");
      }
    }
    if (!isObject(command.session)) errors.push("session_not_object");
    else {
      rejectUnknownFields(command.session, SESSION_KEYS, "session", errors);
      if (typeof command.session.createIfAbsent !== "boolean")
        errors.push("invalid_create_if_absent");
      if (commandType !== AGENT_COMMAND.SEND && command.session.createIfAbsent) {
        errors.push("create_if_absent_requires_send");
      }
    }
    if (commandType === AGENT_COMMAND.CONTINUE) {
      if (!isObject(command.continuation)) errors.push("continuation_not_object");
      else rejectUnknownFields(command.continuation, CONTINUATION_KEYS, "continuation", errors);
      if (!clean(command.continuation?.dialogProcessId))
        errors.push("missing_continuation_dialog_process_id");
      if (!clean(command.continuation?.turnScopeId))
        errors.push("missing_continuation_turn_scope_id");
    }
  } else if (commandType === AGENT_COMMAND.STOP) {
    if (!clean(command.identity?.turnScopeId)) errors.push("missing_turn_scope_id");
    if (!isObject(command.concurrency)) errors.push("concurrency_not_object");
    else {
      rejectUnknownFields(command.concurrency, STOP_CONCURRENCY_KEYS, "concurrency", errors);
      if (
        !Number.isInteger(command.concurrency.expectedTurnRevision) ||
        command.concurrency.expectedTurnRevision < 1
      ) {
        errors.push("invalid_expected_turn_revision");
      }
    }
    if (!isObject(command.stop)) errors.push("stop_not_object");
    else {
      rejectUnknownFields(command.stop, STOP_KEYS, "stop", errors);
      if (Object.prototype.hasOwnProperty.call(command.stop, "partialAssistant")) {
        if (!isObject(command.stop.partialAssistant)) errors.push("partial_assistant_not_object");
        else
          rejectUnknownFields(
            command.stop.partialAssistant,
            PARTIAL_ASSISTANT_KEYS,
            "partial_assistant",
            errors,
          );
      }
    }
  } else if (commandType === AGENT_COMMAND.INTERACTION_RESPONSE) {
    if (!isObject(command.interaction)) errors.push("interaction_not_object");
    else rejectUnknownFields(command.interaction, INTERACTION_KEYS, "interaction", errors);
    if (!clean(command.interaction?.requestId)) errors.push("missing_interaction_request_id");
  } else if (EXECUTION_QUERY_SET.has(commandType)) {
    if (!isObject(command.query)) errors.push("query_not_object");
    else rejectUnknownFields(command.query, QUERY_KEYS, "query", errors);
    const requiresExecutionId = commandType !== AGENT_COMMAND.EXECUTION_TREE_GET;
    if (requiresExecutionId && !clean(command.query?.executionId))
      errors.push("missing_execution_id");
    if (
      !requiresExecutionId &&
      !clean(command.query?.executionId) &&
      !clean(command.query?.rootExecutionId)
    ) {
      errors.push("missing_execution_query_root");
    }
  } else if (commandType === AGENT_COMMAND.TURN_SNAPSHOT_GET) {
    if (!isObject(command.options)) errors.push("options_not_object");
    else rejectUnknownFields(command.options, SNAPSHOT_OPTION_KEYS, "options", errors);
  } else if (commandType === AGENT_COMMAND.FINALIZE) {
    if (!isObject(command.options)) errors.push("options_not_object");
    else rejectUnknownFields(command.options, FINALIZE_OPTION_KEYS, "options", errors);
  }
  return { valid: errors.length === 0, errors };
}

export function validateAgentCommandEnvelope(command) {
  const errors = [];
  if (!isObject(command)) return { valid: false, errors: ["command_not_object"] };
  if (Number(command.protocolVersion) !== AGENT_TRANSPORT_PROTOCOL_VERSION)
    errors.push("unsupported_protocol_version");
  const commandType = clean(command.commandType).toLowerCase();
  if (!COMMAND_TYPE_SET.has(commandType)) errors.push("unsupported_command_type");
  if (!clean(command.commandId)) errors.push("missing_command_id");
  validateIdentity(command, errors);
  return { valid: errors.length === 0, errors };
}

export class AgentTransportProtocolError extends Error {
  constructor(errors = [], command = null) {
    super(`invalid_agent_command: ${errors.join(", ")}`);
    this.name = "AgentTransportProtocolError";
    this.code = "INVALID_AGENT_COMMAND";
    this.errorCode = this.code;
    this.errors = [...errors];
    this.command = command;
    this.statusCode = 400;
  }
}

export function parseAgentCommand(rawCommand) {
  let command;
  try {
    const isBuffer = typeof Buffer !== "undefined" && Buffer.isBuffer(rawCommand);
    command =
      typeof rawCommand === "string" || isBuffer ? JSON.parse(String(rawCommand)) : rawCommand;
  } catch {
    throw new AgentTransportProtocolError(["invalid_json"]);
  }
  const validation = validateAgentCommand(command);
  if (!validation.valid) {
    const envelopeValidation = validateAgentCommandEnvelope(command);
    throw new AgentTransportProtocolError(
      validation.errors,
      envelopeValidation.valid ? command : null,
    );
  }
  return command;
}

export function getAgentCommandIdentity(command = {}) {
  return createIdentity(command.identity);
}
