/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { canonicalizeMessageStore } from "../message/store.js";
import { attachModelContextRuntime } from "./model-runtime.js";
import { MESSAGE_BLOCK_LANES, MODEL_CONTEXT_PROTOCOL_VERSION } from "../agent-context/schema.js";
import { HOOK_PROTOCOL_VERSION } from "@noobot/hook-protocol";
import { normalizeUserMetaBackwrites } from "../policy/user-meta-backwrite.js";
import { isPlainObject, text, isObjectLike } from "@noobot/shared/value";

function asObject(value) {
  return isPlainObject(value) ? value : null;
}

function requireMessageBlocks(messageBlocks) {
  if (!isPlainObject(messageBlocks)) {
    throw new TypeError("modelContext messageBlocks must be a plain object");
  }
  const unexpected = Object.keys(messageBlocks).filter(
    (lane) => !MESSAGE_BLOCK_LANES.includes(lane),
  );
  if (unexpected.length > 0) {
    throw new TypeError(
      `modelContext messageBlocks has unexpected lanes: ${unexpected.join(", ")}`,
    );
  }
  for (const lane of MESSAGE_BLOCK_LANES) {
    if (!Array.isArray(messageBlocks[lane])) {
      throw new TypeError(`modelContext messageBlocks.${lane} must be an array`);
    }
  }
  return Object.fromEntries(MESSAGE_BLOCK_LANES.map((lane) => [lane, messageBlocks[lane]]));
}

function normalizeActiveTurnIdentity(identity = null) {
  if (identity == null) return null;
  const normalized = {
    dialogProcessId: text(identity?.dialogProcessId),
    turnScopeId: text(identity?.turnScopeId),
  };
  if (!normalized.dialogProcessId || !normalized.turnScopeId) {
    throw new Error("modelContext activeTurnIdentity requires dialogProcessId and turnScopeId");
  }
  return normalized;
}

export function createModelContext({
  messageBlocks,
  activeTurnIdentity = null,
  checkpointRevision = 0,
  userMetaBackwrites = [],
  onCanonicalMessageAdded = null,
  onMutationConsumed = null,
}) {
  const normalizedCheckpointRevision = Number(checkpointRevision);
  if (!Number.isInteger(normalizedCheckpointRevision) || normalizedCheckpointRevision < 0) {
    throw new TypeError("modelContext checkpointRevision must be a non-negative integer");
  }
  const modelContext = {
    protocolVersion: MODEL_CONTEXT_PROTOCOL_VERSION,
    checkpointRevision: normalizedCheckpointRevision,
    activeTurnIdentity: normalizeActiveTurnIdentity(activeTurnIdentity),
    userMetaBackwrites: normalizeUserMetaBackwrites(userMetaBackwrites),
    messages: null,
    messageBlocks: requireMessageBlocks(messageBlocks),
  };
  attachModelContextRuntime(modelContext, { onCanonicalMessageAdded, onMutationConsumed });
  canonicalizeMessageStore(modelContext);
  modelContext.messages = MESSAGE_BLOCK_LANES.flatMap((lane) => modelContext.messageBlocks[lane]);
  canonicalizeMessageStore(modelContext);
  return modelContext;
}

export function attachModelContext(context = {}, modelContext = null) {
  if (!isObjectLike(context)) return context;
  context.contextProtocolVersion = HOOK_PROTOCOL_VERSION;
  context.modelContext = modelContext;
  return context;
}

export function resolveAuthoritativeModelContext(context = {}) {
  const modelContext = asObject(context?.modelContext);
  if (modelContext?.protocolVersion === MODEL_CONTEXT_PROTOCOL_VERSION) return modelContext;
  return null;
}

export function validateHookContextProtocol(context = {}, { point = "" } = {}) {
  const warnings = [];
  const version = Number(context?.contextProtocolVersion);
  if (version !== HOOK_PROTOCOL_VERSION)
    warnings.push(`contextProtocolVersion must equal ${HOOK_PROTOCOL_VERSION}`);
  const modelContext = context?.modelContext;
  if (modelContext != null) {
    if (!asObject(modelContext)) warnings.push("modelContext should be object");
    else {
      if (Number(modelContext.protocolVersion) !== MODEL_CONTEXT_PROTOCOL_VERSION)
        warnings.push(`modelContext.protocolVersion must equal ${MODEL_CONTEXT_PROTOCOL_VERSION}`);
      if (!Number.isInteger(modelContext.checkpointRevision) || modelContext.checkpointRevision < 0)
        warnings.push("modelContext.checkpointRevision must be a non-negative integer");
      const activeTurnIdentity = modelContext.activeTurnIdentity;
      if (
        activeTurnIdentity != null &&
        (!asObject(activeTurnIdentity) ||
          !text(activeTurnIdentity?.dialogProcessId) ||
          !text(activeTurnIdentity?.turnScopeId))
      )
        warnings.push(
          "modelContext.activeTurnIdentity must contain dialogProcessId and turnScopeId",
        );
      if (modelContext.messages != null && !Array.isArray(modelContext.messages))
        warnings.push("modelContext.messages should be array");
      if (modelContext.messageBlocks != null && !asObject(modelContext.messageBlocks))
        warnings.push("modelContext.messageBlocks should be object");
    }
  }
  if (typeof context?.resumeFromStoppedSnapshot !== "boolean")
    warnings.push("resumeFromStoppedSnapshot must be boolean");
  const normalizedPoint = text(point || context?.point);
  if (!normalizedPoint) warnings.push("point should be present");
  return { success: warnings.length === 0, warnings };
}

export function resolveHookClientEmitter(context = {}) {
  if (typeof context?.emitHookClientEvent !== "function") return null;
  return (event, data) => context.emitHookClientEvent(event, data);
}
