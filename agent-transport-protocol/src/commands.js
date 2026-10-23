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
import { isExecutionQueryTargetValid } from "@noobot/session-protocol/execution-lifecycle";
import {
  isTurnSnapshotKnownSequence,
  isTurnSnapshotTerminalLimit,
} from "@noobot/session-protocol/turn-lifecycle";
import {
  deriveInteractionCommandId,
  deriveStopCommandId,
  deriveTurnCommandId,
} from "@noobot/session-protocol/turn-command-id";
import { createRunPreferences, validateRunPreferences } from "./run-preferences.js";
import { isCanonicalText, isPlainObject, text } from "@noobot/shared/value";

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
const PRESENTATION_KEYS = new Set(["userMessageId", "presentationMessageId"]);
const RUN_CONCURRENCY_KEYS = new Set(["expectedTurnRevision", "expectedAggregateVersion"]);
const STOP_CONCURRENCY_KEYS = new Set(["expectedTurnRevision"]);
const SESSION_KEYS = new Set(["createIfAbsent", "selectedConnectorIds"]);
const CONTINUATION_KEYS = new Set(["dialogProcessId", "turnScopeId"]);

const STOP_KEYS = new Set(["executionId"]);
const INTERACTION_KEYS = new Set(["requestId", "response"]);
const QUERY_KEYS = new Set(["executionId", "rootExecutionId"]);
const SNAPSHOT_OPTION_KEYS = new Set(["knownSequence", "terminalLimit"]);
const FINALIZE_OPTION_KEYS = new Set(["terminalLimit"]);
const INTERJECTION_KEYS = new Set(["message"]);

const clean = (value) => text(value);
function compactObject(source = {}) {
  return Object.fromEntries(
    Object.entries(source).filter(([, value]) => value !== undefined && value !== ""),
  );
}

function createIdentity(input) {
  if (!isPlainObject(input)) throw new TypeError("identity_not_object");
  return Object.fromEntries(
    [...IDENTITY_KEYS].map((key) => [key, input[key] === undefined ? "" : input[key]]),
  );
}

const DERIVED_COMMAND_ID_SOURCES = Object.freeze({
  [AGENT_COMMAND.SEND]: (command) => deriveTurnCommandId(command.identity?.turnScopeId),
  [AGENT_COMMAND.RESEND]: (command) => deriveTurnCommandId(command.identity?.turnScopeId),
  [AGENT_COMMAND.CONTINUE]: (command) => deriveTurnCommandId(command.identity?.turnScopeId),
  [AGENT_COMMAND.STOP]: (command) => deriveStopCommandId(command.identity?.turnScopeId),
  [AGENT_COMMAND.INTERACTION_RESPONSE]: (command) =>
    deriveInteractionCommandId(command.interaction?.requestId),
});

export function deriveAgentCommandId(command) {
  const derive = DERIVED_COMMAND_ID_SOURCES[command.commandType];
  if (!derive) throw new TypeError("command_id_not_derivable");
  return derive(command);
}

function createEnvelope(commandType, input) {
  return {
    protocolVersion: AGENT_TRANSPORT_PROTOCOL_VERSION,
    commandType,
    commandId: input.commandId,
    identity: createIdentity(input.identity),
  };
}

function assertValidCommand(command) {
  const validation = validateAgentCommand(command);
  if (!validation.valid) throw new AgentTransportProtocolError(validation.errors, command);
  return command;
}

function withDerivedCommandId(input, command) {
  if (Object.prototype.hasOwnProperty.call(input, "commandId")) {
    throw new TypeError("command_id_is_protocol_derived");
  }
  return assertValidCommand({ ...command, commandId: deriveAgentCommandId(command) });
}

export function createTurnRunCommand(input = {}) {
  const { commandType } = input;
  if (!RUN_COMMAND_SET.has(commandType)) throw new TypeError("invalid_run_command_type");
  return withDerivedCommandId(input, {
    ...createEnvelope(commandType, input),
    input: {
      message: String(input.input?.message ?? ""),
      attachments: Array.isArray(input.input?.attachments) ? input.input.attachments : [],
    },
    preferences: createRunPreferences(input.preferences),
    presentation: compactObject({
      userMessageId: clean(input.presentation?.userMessageId),
      presentationMessageId: clean(input.presentation?.presentationMessageId),
    }),
    concurrency: compactObject({
      expectedTurnRevision: input.concurrency?.expectedTurnRevision,
      expectedAggregateVersion: input.concurrency?.expectedAggregateVersion,
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
  });
}

export function createTurnStopCommand(input = {}) {
  const expectedTurnRevision = input.concurrency?.expectedTurnRevision;
  if (!Number.isInteger(expectedTurnRevision) || expectedTurnRevision < 1) {
    throw new TypeError("invalid_expected_turn_revision");
  }
  return withDerivedCommandId(input, {
    ...createEnvelope(AGENT_COMMAND.STOP, input),
    concurrency: { expectedTurnRevision },

    stop: compactObject({ ...input.stop, executionId: clean(input.stop?.executionId) }),
  });
}

export function createTurnInterjectionCommand(input) {
  return assertValidCommand({
    ...createEnvelope(AGENT_COMMAND.INTERJECT, input),
    interaction: { message: input.interaction?.message },
  });
}

export function createInteractionResponseCommand(input = {}) {
  return withDerivedCommandId(input, {
    ...createEnvelope(AGENT_COMMAND.INTERACTION_RESPONSE, input),
    interaction: {
      requestId: clean(input.interaction?.requestId),
      response: input.interaction?.response ?? {},
    },
  });
}

export function createExecutionQueryCommand(input) {
  if (!EXECUTION_QUERY_SET.has(input.commandType)) {
    throw new TypeError("invalid_execution_query_command_type");
  }
  return assertValidCommand({
    ...createEnvelope(input.commandType, input),
    query: {
      executionId: input.query?.executionId,
      rootExecutionId: input.query?.rootExecutionId,
    },
  });
}

export function createTurnSnapshotCommand(input) {
  return assertValidCommand({
    ...createEnvelope(AGENT_COMMAND.TURN_SNAPSHOT_GET, input),
    options: {
      knownSequence: input.options?.knownSequence,
      terminalLimit: input.options?.terminalLimit,
    },
  });
}

export function createTurnFinalizeCommand(input) {
  return assertValidCommand({
    ...createEnvelope(AGENT_COMMAND.FINALIZE, input),
    options: { terminalLimit: input.options?.terminalLimit },
  });
}

function validateIdentity(command, errors) {
  if (!isPlainObject(command.identity)) {
    errors.push("identity_not_object");
    return;
  }
  rejectUnknownFields(command.identity, IDENTITY_KEYS, "identity", errors);
  for (const key of IDENTITY_KEYS) {
    const value = command.identity[key];
    if (typeof value !== "string" || value !== value.trim()) {
      errors.push(`invalid_identity_field:${key}`);
    }
  }
  if (!isCanonicalText(command.identity.sessionId)) errors.push("missing_session_id");
}

function rejectUnknownFields(value, allowedKeys, path, errors) {
  if (!isPlainObject(value)) return;
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
  if (command.protocolVersion !== AGENT_TRANSPORT_PROTOCOL_VERSION)
    errors.push("unsupported_protocol_version");
  const { commandType } = command;
  if (!COMMAND_TYPE_SET.has(commandType)) errors.push("unsupported_command_type");
  if (!isCanonicalText(command.commandId)) errors.push("missing_command_id");
  return commandType;
}

function validateNestedObject(value, allowedKeys, path, errors) {
  if (!isPlainObject(value)) {
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

function validateRunPresentation(command, errors) {
  if (!validateNestedObject(command.presentation, PRESENTATION_KEYS, "presentation", errors)) {
    return;
  }
  if (!clean(command.presentation.userMessageId)) errors.push("missing_user_message_id");
  if (!clean(command.presentation.presentationMessageId))
    errors.push("missing_presentation_message_id");
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
  } else if (clean(command.identity?.dialogProcessId)) {
    errors.push("unexpected_dialog_process_id");
  }
  validateRunInput(command, errors);
  errors.push(...validateRunPreferences(command.preferences).errors);
  validateRunPresentation(command, errors);
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
  validateNestedObject(command.stop, STOP_KEYS, "stop", errors);
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
  if (!validateNestedObject(command.query, QUERY_KEYS, "query", errors)) return;
  for (const key of QUERY_KEYS) {
    const value = command.query[key];
    if (typeof value !== "string" || value !== value.trim()) {
      errors.push(`invalid_query_field:${key}`);
    }
  }
  if (!isExecutionQueryTargetValid(commandType, command.query)) {
    errors.push("invalid_execution_query_target");
  }
}

function validateSnapshotOptions(command, allowedKeys, errors) {
  if (!validateNestedObject(command.options, allowedKeys, "options", errors)) return;
  if (
    allowedKeys.has("knownSequence") &&
    !isTurnSnapshotKnownSequence(command.options.knownSequence)
  ) {
    errors.push("invalid_known_sequence");
  }
  if (!isTurnSnapshotTerminalLimit(command.options.terminalLimit)) {
    errors.push("invalid_terminal_limit");
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
    validateSnapshotOptions(command, SNAPSHOT_OPTION_KEYS, errors);
  } else if (commandType === AGENT_COMMAND.FINALIZE) {
    validateSnapshotOptions(command, FINALIZE_OPTION_KEYS, errors);
  }
}

export function validateAgentCommand(command) {
  const errors = [];
  if (!isPlainObject(command)) return { valid: false, errors: ["command_not_object"] };
  const commandType = validateCommandHeader(command, errors);
  validateTopLevelFields(command, commandType, errors);
  validateIdentity(command, errors);
  validateCommandBody(command, commandType, errors);
  validateDerivedCommandId(command, commandType, errors);
  return { valid: errors.length === 0, errors };
}

function validateDerivedCommandId(command, commandType, errors) {
  if (errors.length > 0 || !DERIVED_COMMAND_ID_SOURCES[commandType]) return;
  if (command.commandId !== deriveAgentCommandId(command)) {
    errors.push("command_id_not_derived");
  }
}

function validateAgentCommandEnvelope(command) {
  const errors = [];
  if (!isPlainObject(command)) return { valid: false, errors: ["command_not_object"] };
  validateCommandHeader(command, errors);
  validateIdentity(command, errors);
  return { valid: errors.length === 0, errors };
}

class AgentTransportProtocolError extends Error {
  constructor(errors = [], command = null) {
    super(`invalid_agent_command: ${errors.join(", ")}`);
    this.name = "AgentTransportProtocolError";
    this.code = "INVALID_AGENT_COMMAND";
    this.errors = [...errors];
    this.command = command;
    this.statusCode = 400;
  }
}

export function isAgentTransportProtocolError(error) {
  return error instanceof AgentTransportProtocolError;
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
