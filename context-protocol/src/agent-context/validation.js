/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import {
  AGENT_CONTEXT_KIND,
  AGENT_CONTEXT_PROTOCOL_VERSION,
  MODEL_CONTEXT_PROTOCOL_VERSION,
} from "./schema.js";
import { validateAgentContextIdentity } from "./identity.js";

function findSerializationError(value, path = "context", seen = new Set()) {
  if (value == null || ["string", "number", "boolean"].includes(typeof value)) return "";
  if (typeof value === "function" || typeof value === "symbol" || typeof value === "bigint") {
    return `${path} is not JSON-serializable`;
  }
  if (typeof value !== "object") return `${path} is not JSON-serializable`;
  if (seen.has(value)) return `${path} contains a circular reference`;
  seen.add(value);
  if (!Array.isArray(value)) {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      return `${path} must be a plain object`;
    }
  }
  for (const [key, child] of Object.entries(value)) {
    const error = findSerializationError(child, `${path}.${key}`, seen);
    if (error) return error;
  }
  seen.delete(value);
  return "";
}

export function validateAgentContextEnvelope(context = {}) {
  const errors = [];
  if (context?.kind !== AGENT_CONTEXT_KIND) errors.push(`kind must equal ${AGENT_CONTEXT_KIND}`);
  if (Number(context?.protocolVersion) !== AGENT_CONTEXT_PROTOCOL_VERSION) {
    errors.push(`protocolVersion must equal ${AGENT_CONTEXT_PROTOCOL_VERSION}`);
  }
  if (Object.prototype.hasOwnProperty.call(context, "runtime")) errors.push("runtime is forbidden");
  if (context?.execution?.controllers != null) errors.push("execution.controllers is forbidden");
  if (context?.payload?.tools != null) errors.push("payload.tools is forbidden");
  const identityResult = validateAgentContextIdentity(context?.identity);
  errors.push(...identityResult.errors);
  const modelContext = context?.modelContext;
  if (!modelContext || typeof modelContext !== "object") {
    errors.push("modelContext is required");
  } else {
    if (Number(modelContext.protocolVersion) !== MODEL_CONTEXT_PROTOCOL_VERSION) {
      errors.push(`modelContext.protocolVersion must equal ${MODEL_CONTEXT_PROTOCOL_VERSION}`);
    }
    if (!Number.isInteger(modelContext.checkpointRevision) || modelContext.checkpointRevision < 0) {
      errors.push("modelContext.checkpointRevision must be a non-negative integer");
    }
    if (!Array.isArray(modelContext.userMetaBackwrites)) {
      errors.push("modelContext.userMetaBackwrites must be an array");
    }
    const active = modelContext.activeTurnIdentity || {};
    if (String(active.dialogProcessId || "").trim() !== identityResult.identity.dialogProcessId) {
      errors.push(
        "modelContext.activeTurnIdentity.dialogProcessId must match identity.dialogProcessId",
      );
    }
    if (String(active.turnScopeId || "").trim() !== identityResult.identity.turnScopeId) {
      errors.push("modelContext.activeTurnIdentity.turnScopeId must match identity.turnScopeId");
    }
    if (!modelContext.messageBlocks || typeof modelContext.messageBlocks !== "object") {
      errors.push("modelContext.messageBlocks is required");
    }
  }
  const serializationError = findSerializationError(context);
  if (serializationError) errors.push(serializationError);
  return { success: errors.length === 0, errors };
}

export function assertValidAgentContextEnvelope(context = {}) {
  const result = validateAgentContextEnvelope(context);
  if (!result.success) {
    throw new TypeError(`invalid agent context envelope: ${result.errors.join("; ")}`);
  }
  return context;
}
