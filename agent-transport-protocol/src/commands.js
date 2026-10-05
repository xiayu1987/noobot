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
import { EXECUTION_QUERY_CONTRACT } from "@noobot/session-protocol/execution-lifecycle";
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
const SESSION_KEYS = new Set(["createIfAbsent", "selectedConnectorIds"]);
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
const INTERJECTION_KEYS = new Set(["message"]);

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
      selectedConnectorIds: Array.isArray(input.session?.selectedConnectorIds)
        ? input.session.selectedConnectorIds.map(clean).filter(Boolean)
        : [],
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

export function createTurnInterjectionCommand(input = {}) {
  return {
    ...createEnvelope(AGENT_COMMAND.INTERJECT, input),
    interaction: {
      message: String(input.interaction?.message ?? ""),
    },
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

function allowedTopLevelKeys(commandType) {
  if (RUN_COMMAND_SET.has(commandType)) {
    return [
      ...BASE_COMMAND_KEYS,
      "input",
      "preferences",
      "presentation",
      "concurrency",
      "session",
      ...(commandType === AGENT_COMMAND.CONTINUE ? ["continuation"] : []),
    ];
  }
  if (commandType === AGENT_COMMAND.STOP) return [...BASE_COMMAND_KEYS, "concurrency", "stop"];
  if (
    commandType === AGENT_COMMAND.INTERJECT ||
    commandType === AGENT_COMMAND.INTERACTION_RESPONSE
  ) {
    return [...BASE_COMMAND_KEYS, "interaction"];
  }
  if (EXECUTION_QUERY_SET.has(commandType)) return [...BASE_COMMAND_KEYS, "query"];
  if (commandType === AGENT_COMMAND.TURN_SNAPSHOT_GET || commandType === AGENT_COMMAND.FINALIZE) {
    return [...BASE_COMMAND_KEYS, "options"];
  }
  return [...BASE_COMMAND_KEYS];
}

function validateTopLevelFields(command, commandType, errors) {
  const allowedKeys = new Set(allowedTopLevelKeys(commandType));
  for (const key of Object.keys(command)) {
    if (!TOP_LEVEL_KEYS.has(key)) errors.push(`unknown_top_level_field:${key}`);
    else if (!allowedKeys.has(key)) errors.push(`unexpected_top_level_field:${key}`);
  }
}

function validateCommandHeader(command, errors) {
  if (Number(command.protocolVersion) !== AGENT_TRANSPORT_PROTOCOL_VERSION)
    errors.push("unsupported_protocol_version");
  const commandType = clean(command.commandType).toLowerCase();
  if (!COMMAND_TYPE_SET.has(commandType)) errors.push("unsupported_command_type");
  if (!clean(command.commandId)) errors.push("missing_command_id");
  return commandType;
}

function validateNestedObject(value, allowedKeys, path, errors) {
  if (!isObject(value)) {
    errors.push(`${path}_not_object`);
    return false;
  }
  rejectUnknownFields(value, allowedKeys, path, errors);
  return true;
}

function requireIdentityField(command, field, code, errors) {
  if (!clean(command.identity?.[field])) errors.push(code);
}

function hasInvalidConnectorIds(connectorIds) {
  return (
    connectorIds.some((connectorId) => typeof connectorId !== "string" || !clean(connectorId)) ||
    new Set(connectorIds.map(clean)).size !== connectorIds.length
  );
}

function validateRunInput(command, errors) {
  if (!validateNestedObject(command.input, INPUT_KEYS, "input", errors)) return;
  if (!clean(command.input.message)) errors.push("missing_message");
  if (!Array.isArray(command.input.attachments)) errors.push("invalid_attachments");
}

function validateRunConcurrency(command, errors) {
  if (!validateNestedObject(command.concurrency, RUN_CONCURRENCY_KEYS, "concurrency", errors)) {
    return;
  }
  const { expectedTurnRevision, expectedAggregateVersion } = command.concurrency;
  if (expectedTurnRevision !== 0) errors.push("run_turn_revision_must_be_zero");
  if (!Number.isInteger(expectedAggregateVersion) || expectedAggregateVersion < 0) {
    errors.push("invalid_expected_session_version");
  }
}

function validateRunSession(command, commandType, errors) {
  if (!validateNestedObject(command.session, SESSION_KEYS, "session", errors)) return;
  const { selectedConnectorIds, createIfAbsent } = command.session;
  if (!Array.isArray(selectedConnectorIds) || hasInvalidConnectorIds(selectedConnectorIds)) {
    errors.push("invalid_session_selected_connector_ids");
  }
  if (!createIfAbsent && selectedConnectorIds?.length) {
    errors.push("unexpected_session_selected_connector_ids");
  }
  if (typeof createIfAbsent !== "boolean") errors.push("invalid_create_if_absent");
  if (commandType !== AGENT_COMMAND.SEND && createIfAbsent) {
    errors.push("create_if_absent_requires_send");
  }
}

function validateContinuation(command, errors) {
  validateNestedObject(command.continuation, CONTINUATION_KEYS, "continuation", errors);
  if (!clean(command.continuation?.dialogProcessId)) {
    errors.push("missing_continuation_dialog_process_id");
  }
  if (!clean(command.continuation?.turnScopeId)) errors.push("missing_continuation_turn_scope_id");
}

function validateRunCommand(command, commandType, errors) {
  requireIdentityField(command, "turnScopeId", "missing_turn_scope_id", errors);
  if (commandType === AGENT_COMMAND.RESEND) {
    requireIdentityField(command, "dialogProcessId", "missing_resend_dialog_process_id", errors);
  }
  validateRunInput(command, errors);
  errors.push(...validateRunPreferences(command.preferences).errors);
  validateNestedObject(command.presentation, PRESENTATION_KEYS, "presentation", errors);
  validateRunConcurrency(command, errors);
  validateRunSession(command, commandType, errors);
  if (commandType === AGENT_COMMAND.CONTINUE) validateContinuation(command, errors);
}

function validateStopCommand(command, errors) {
  requireIdentityField(command, "turnScopeId", "missing_turn_scope_id", errors);
  if (validateNestedObject(command.concurrency, STOP_CONCURRENCY_KEYS, "concurrency", errors)) {
    const { expectedTurnRevision } = command.concurrency;
    if (!Number.isInteger(expectedTurnRevision) || expectedTurnRevision < 1) {
      errors.push("invalid_expected_turn_revision");
    }
  }
  if (!validateNestedObject(command.stop, STOP_KEYS, "stop", errors)) return;
  if (Object.prototype.hasOwnProperty.call(command.stop, "partialAssistant")) {
    validateNestedObject(
      command.stop.partialAssistant,
      PARTIAL_ASSISTANT_KEYS,
      "partial_assistant",
      errors,
    );
  }
}

function validateInterjectCommand(command, errors) {
  requireIdentityField(command, "turnScopeId", "missing_turn_scope_id", errors);
  requireIdentityField(command, "dialogProcessId", "missing_dialog_process_id", errors);
  validateNestedObject(command.interaction, INTERJECTION_KEYS, "interaction", errors);
  if (!clean(command.interaction?.message)) errors.push("missing_interjection_message");
}

function validateInteractionResponseCommand(command, errors) {
  validateNestedObject(command.interaction, INTERACTION_KEYS, "interaction", errors);
  if (!clean(command.interaction?.requestId)) errors.push("missing_interaction_request_id");
}

function validateExecutionQueryCommand(command, commandType, errors) {
  validateNestedObject(command.query, QUERY_KEYS, "query", errors);
  const { requiresExecutionId } = EXECUTION_QUERY_CONTRACT[commandType];
  const hasExecutionId = Boolean(clean(command.query?.executionId));
  if (requiresExecutionId && !hasExecutionId) errors.push("missing_execution_id");
  if (!requiresExecutionId && !hasExecutionId && !clean(command.query?.rootExecutionId)) {
    errors.push("missing_execution_query_root");
  }
}

function validateCommandBody(command, commandType, errors) {
  if (RUN_COMMAND_SET.has(commandType)) validateRunCommand(command, commandType, errors);
  else if (commandType === AGENT_COMMAND.STOP) validateStopCommand(command, errors);
  else if (commandType === AGENT_COMMAND.INTERJECT) validateInterjectCommand(command, errors);
  else if (commandType === AGENT_COMMAND.INTERACTION_RESPONSE) {
    validateInteractionResponseCommand(command, errors);
  } else if (EXECUTION_QUERY_SET.has(commandType)) {
    validateExecutionQueryCommand(command, commandType, errors);
  } else if (commandType === AGENT_COMMAND.TURN_SNAPSHOT_GET) {
    validateNestedObject(command.options, SNAPSHOT_OPTION_KEYS, "options", errors);
  } else if (commandType === AGENT_COMMAND.FINALIZE) {
    validateNestedObject(command.options, FINALIZE_OPTION_KEYS, "options", errors);
  }
}

export function validateAgentCommand(command) {
  const errors = [];
  if (!isObject(command)) return { valid: false, errors: ["command_not_object"] };
  const commandType = validateCommandHeader(command, errors);
  validateTopLevelFields(command, commandType, errors);
  validateIdentity(command, errors);
  validateCommandBody(command, commandType, errors);
  return { valid: errors.length === 0, errors };
}

export function validateAgentCommandEnvelope(command) {
  const errors = [];
  if (!isObject(command)) return { valid: false, errors: ["command_not_object"] };
  validateCommandHeader(command, errors);
  validateIdentity(command, errors);
  return { valid: errors.length === 0, errors };
}

export class AgentTransportProtocolError extends Error {
  constructor(errors = [], command = null) {
    super(`invalid_agent_command: ${errors.join(", ")}`);
    this.name = "AgentTransportProtocolError";
    this.code = "INVALID_AGENT_COMMAND";
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
