/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { canonicalizeMessageStore } from "../message/message-store.js";
import { attachModelContextRuntime } from "./model-context-runtime.js";
import { MODEL_CONTEXT_PROTOCOL_VERSION } from "../agent-context/agent-context-schema.js";
import { HOOK_PROTOCOL_VERSION } from "@noobot/hook-protocol";

function asObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

function normalizeBlocks(value) {
  const blocks = asObject(value);
  if (!blocks) return null;
  return {
    system: Array.isArray(blocks.system) ? blocks.system : [],
    history: Array.isArray(blocks.history) ? blocks.history : [],
    incremental: Array.isArray(blocks.incremental) ? blocks.incremental : [],
  };
}

function resolveMessageRole(message = {}) {
  const role = String(message?.role || message?.lc_kwargs?.role || "")
    .trim()
    .toLowerCase();
  if (role) return role;
  const type = String(
    message?.type ||
      message?.lc_kwargs?.type ||
      (typeof message?._getType === "function" ? message._getType() : ""),
  )
    .trim()
    .toLowerCase();
  if (type === "ai") return "assistant";
  if (type === "human") return "user";
  return type;
}

function resolveInitialBlocks(messages = []) {
  const blocks = { system: [], history: [], incremental: [] };
  for (const message of Array.isArray(messages) ? messages : []) {
    const blockName = ["system", "developer"].includes(resolveMessageRole(message))
      ? "system"
      : "incremental";
    blocks[blockName].push(message);
  }
  return blocks;
}

function normalizeActiveTurnIdentity(identity = null) {
  if (identity == null) return null;
  const normalized = {
    dialogProcessId: String(identity?.dialogProcessId || "").trim(),
    turnScopeId: String(identity?.turnScopeId || "").trim(),
  };
  if (!normalized.dialogProcessId || !normalized.turnScopeId) {
    throw new Error("modelContext activeTurnIdentity requires dialogProcessId and turnScopeId");
  }
  return normalized;
}

export function createModelContext({
  messages = null,
  messageBlocks = null,
  activeTurnIdentity = null,
  onCanonicalMessageAdded = null,
  onMutationConsumed = null,
} = {}) {
  const explicitBlocks = normalizeBlocks(messageBlocks);
  const blocks =
    explicitBlocks || (Array.isArray(messages) ? resolveInitialBlocks(messages) : null);
  // Explicit blocks are the authoritative context partition. A flat message
  // projection supplied beside them must not be used to infer additional block
  // membership, otherwise stale/filtered messages can silently re-enter the
  // model context through a compatibility-shaped second source.
  const resolvedMessages = explicitBlocks
    ? [...explicitBlocks.system, ...explicitBlocks.history, ...explicitBlocks.incremental]
    : Array.isArray(messages)
      ? messages
      : blocks
        ? [...blocks.system, ...blocks.history, ...blocks.incremental]
        : null;
  if (!blocks && !resolvedMessages) return null;
  const modelContext = {
    protocolVersion: MODEL_CONTEXT_PROTOCOL_VERSION,
    activeTurnIdentity: normalizeActiveTurnIdentity(activeTurnIdentity),
    // When blocks are explicit, hydrate their entity identities before
    // materializing the flat projection. Hydrating the flat list first would
    // assign two ids to legacy copies of the same scoped message and prevent
    // deterministic cross-block de-duplication.
    messages: explicitBlocks ? null : resolvedMessages,
    messageBlocks: blocks,
  };
  attachModelContextRuntime(modelContext, { onCanonicalMessageAdded, onMutationConsumed });
  canonicalizeMessageStore(modelContext);
  if (explicitBlocks) {
    modelContext.messages = [
      ...modelContext.messageBlocks.system,
      ...modelContext.messageBlocks.history,
      ...modelContext.messageBlocks.incremental,
    ];
    canonicalizeMessageStore(modelContext);
  }
  return modelContext;
}

export function attachModelContext(context = {}, modelContext = null) {
  if (!context || typeof context !== "object") return context;
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
      const activeTurnIdentity = modelContext.activeTurnIdentity;
      if (
        activeTurnIdentity != null &&
        (!asObject(activeTurnIdentity) ||
          !String(activeTurnIdentity?.dialogProcessId || "").trim() ||
          !String(activeTurnIdentity?.turnScopeId || "").trim())
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
  const normalizedPoint = String(point || context?.point || "").trim();
  if (!normalizedPoint) warnings.push("point should be present");
  return { success: warnings.length === 0, warnings };
}

export function resolveHookClientEmitter(context = {}) {
  if (typeof context?.emitHookClientEvent !== "function") return null;
  return (event, data) => context.emitHookClientEvent(event, data);
}

export function resolveModelContextTraceEmitter(context = {}) {
  if (typeof context?.emitModelContextTrace !== "function") return null;
  return (stage, payload) => context.emitModelContextTrace(stage, payload);
}
