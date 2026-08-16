/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import {
  appendMessage,
  markMessagesSummarizedByIds,
  pruneSummarizedIncrementalMessages,
  removeMessagesByIds,
  replaceMessageProjection,
  replaceMessages,
  writeMessageBlocks,
} from "../message/store.js";
import {
  commitModelContextRevision,
  getModelContextRevision,
  getModelContextRuntime,
} from "../assembly/model-runtime.js";
import { MODEL_CONTEXT_PROTOCOL_VERSION } from "../agent-context/schema.js";

export const CONTEXT_MUTATION_PROTOCOL_VERSION = 2;

export const CONTEXT_MUTATION_TYPES = Object.freeze({
  APPEND_MESSAGE: "context.message.append",
  REPLACE_MESSAGES: "context.messages.replace",
  REPLACE_PROJECTION: "context.projection.replace",
  WRITE_BLOCKS: "context.blocks.write",
  MARK_SUMMARIZED: "context.messages.mark-summarized",
  PRUNE_SUMMARIZED_INCREMENTAL: "context.incremental.prune-summarized",
  REMOVE_MESSAGES_BY_ID: "context.messages.remove-by-id",
});

let nextCommandSequence = 1;

function requireDocument(document) {
  if (Number(document?.protocolVersion) !== MODEL_CONTEXT_PROTOCOL_VERSION) {
    throw new TypeError(
      `context mutation requires modelContext protocolVersion=${MODEL_CONTEXT_PROTOCOL_VERSION}`,
    );
  }
  getModelContextRuntime(document);
  return document;
}

export function createContextMutation(document, commandType, payload = {}) {
  requireDocument(document);
  const normalizedType = String(commandType || "").trim();
  if (!Object.values(CONTEXT_MUTATION_TYPES).includes(normalizedType)) {
    throw new TypeError(`unsupported context mutation command: ${normalizedType}`);
  }
  return {
    protocolVersion: CONTEXT_MUTATION_PROTOCOL_VERSION,
    commandType: normalizedType,
    commandId: `context_command_${nextCommandSequence++}`,
    expectedRevision: getModelContextRevision(document),
    payload,
  };
}

export function dispatchContextMutation(document, command = {}) {
  requireDocument(document);
  if (Number(command?.protocolVersion) !== CONTEXT_MUTATION_PROTOCOL_VERSION) {
    throw new TypeError(
      `context mutation protocolVersion must equal ${CONTEXT_MUTATION_PROTOCOL_VERSION}`,
    );
  }
  const commandId = String(command?.commandId || "").trim();
  if (!commandId) throw new TypeError("context mutation commandId is required");
  const expectedRevision = Number(command?.expectedRevision);
  const actualRevision = getModelContextRevision(document);
  if (!Number.isInteger(expectedRevision) || expectedRevision !== actualRevision) {
    throw new Error(
      `context mutation revision conflict: expected ${expectedRevision}, actual ${actualRevision}`,
    );
  }
  const payload = command?.payload && typeof command.payload === "object" ? command.payload : {};
  let value;
  switch (command.commandType) {
    case CONTEXT_MUTATION_TYPES.APPEND_MESSAGE:
      value = appendMessage(document, payload.message, { block: payload.block });
      break;
    case CONTEXT_MUTATION_TYPES.REPLACE_MESSAGES:
      value = replaceMessages(document, payload.messages);
      break;
    case CONTEXT_MUTATION_TYPES.REPLACE_PROJECTION:
      value = replaceMessageProjection(document, payload.messages);
      break;
    case CONTEXT_MUTATION_TYPES.WRITE_BLOCKS:
      value = writeMessageBlocks(document, payload.blocks);
      break;
    case CONTEXT_MUTATION_TYPES.MARK_SUMMARIZED:
      value = markMessagesSummarizedByIds(document, payload.messageIds);
      break;
    case CONTEXT_MUTATION_TYPES.PRUNE_SUMMARIZED_INCREMENTAL:
      value = pruneSummarizedIncrementalMessages(document);
      break;
    case CONTEXT_MUTATION_TYPES.REMOVE_MESSAGES_BY_ID:
      value = removeMessagesByIds(document, payload.messageIds);
      break;
    default:
      throw new TypeError(`unsupported context mutation command: ${command.commandType}`);
  }
  const revision = commitModelContextRevision(document);
  const result = { accepted: true, commandId, commandType: command.commandType, revision, value };
  const observer = getModelContextRuntime(document).onMutationConsumed;
  if (typeof observer === "function") observer(result);
  return result;
}

export function executeContextMutation(document, commandType, payload = {}) {
  return dispatchContextMutation(document, createContextMutation(document, commandType, payload));
}

export function appendContextMessage(document, message, { block = "" } = {}) {
  return executeContextMutation(document, CONTEXT_MUTATION_TYPES.APPEND_MESSAGE, { message, block })
    .value;
}

export function replaceContextMessages(document, messages) {
  return executeContextMutation(document, CONTEXT_MUTATION_TYPES.REPLACE_MESSAGES, { messages })
    .value;
}

export function replaceContextProjection(document, messages) {
  return executeContextMutation(document, CONTEXT_MUTATION_TYPES.REPLACE_PROJECTION, { messages })
    .value;
}

export function writeContextBlocks(document, blocks) {
  return executeContextMutation(document, CONTEXT_MUTATION_TYPES.WRITE_BLOCKS, { blocks }).value;
}

export function markContextMessagesSummarized(document, messageIds) {
  return executeContextMutation(document, CONTEXT_MUTATION_TYPES.MARK_SUMMARIZED, { messageIds })
    .value;
}

export function pruneContextSummarizedIncremental(document) {
  return executeContextMutation(document, CONTEXT_MUTATION_TYPES.PRUNE_SUMMARIZED_INCREMENTAL)
    .value;
}

export function removeContextMessagesByIds(document, messageIds) {
  return executeContextMutation(document, CONTEXT_MUTATION_TYPES.REMOVE_MESSAGES_BY_ID, {
    messageIds,
  }).value;
}
