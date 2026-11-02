/* Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { MODEL_PROTOCOL_NAME, MODEL_PROTOCOL_VERSION } from "./constants.js";
import { requireInvocationIdentity } from "./invocation.js";
import { requireModelSpec } from "../model/model-spec.js";
import { normalizeModelOperation } from "./operation.js";
import { requireModelOperationCapability } from "./capability.js";
import { isPlainObject } from "@noobot/shared/value";
import { MODEL_CONTEXT_SEQUENCE_POLICY } from "../policy/context-policy.js";

const MODEL_REQUEST_METADATA_KEYS = new Set(["context"]);

function requireModelRequestMetadata(metadata, contextSequencePolicy) {
  if (metadata !== undefined && !isPlainObject(metadata))
    throw new TypeError("model request.metadata must be an object");
  for (const key of Object.keys(metadata || {})) {
    if (!MODEL_REQUEST_METADATA_KEYS.has(key))
      throw new TypeError(`model request.metadata.${key} is not part of the protocol`);
  }
  const context = metadata?.context;
  if (contextSequencePolicy !== MODEL_CONTEXT_SEQUENCE_POLICY.CHECKPOINT_APPEND_ONLY) {
    if (context !== undefined)
      throw new TypeError(
        `model request.metadata.context is only allowed for ${MODEL_CONTEXT_SEQUENCE_POLICY.CHECKPOINT_APPEND_ONLY}`,
      );
    return Object.freeze({});
  }
  if (!isPlainObject(context))
    throw new TypeError(
      `model request.metadata.context is required for ${MODEL_CONTEXT_SEQUENCE_POLICY.CHECKPOINT_APPEND_ONLY}`,
    );
  for (const key of Object.keys(context)) {
    if (key !== "summaryCheckpointRevision")
      throw new TypeError(`model request.metadata.context.${key} is not part of the protocol`);
  }
  const { summaryCheckpointRevision } = context;
  if (!Number.isInteger(summaryCheckpointRevision) || summaryCheckpointRevision < 0)
    throw new TypeError(
      "model request.metadata.context.summaryCheckpointRevision must be a non-negative integer",
    );
  return Object.freeze({ context: Object.freeze({ summaryCheckpointRevision }) });
}

export function createModelRequest(input = {}) {
  const invocation = requireInvocationIdentity(input.invocation);
  const model = requireModelSpec(input.model);
  const operation = normalizeModelOperation(input.operation);
  requireModelOperationCapability(model, operation.kind);
  if (!Array.isArray(input.messages))
    throw new TypeError("model request.messages must be an array");
  return Object.freeze({
    protocol: MODEL_PROTOCOL_NAME,
    protocolVersion: MODEL_PROTOCOL_VERSION,
    invocation,
    model,
    operation,
    messages: input.messages,
    tools: Array.isArray(input.tools) ? input.tools : [],
    options: Object.freeze({ ...input.options }),
    policies: Object.freeze({ ...input.policies }),
    metadata: requireModelRequestMetadata(input.metadata, invocation.contextSequencePolicy),
  });
}
