/* Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { MODEL_PROTOCOL_NAME, MODEL_PROTOCOL_VERSION } from "./constants.js";
import { requireInvocationIdentity } from "./invocation.js";
import { requireModelSpec } from "../model/model-spec.js";
import { normalizeModelOperation } from "./operation.js";
import { requireModelOperationCapability } from "./capability.js";

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
    metadata: Object.freeze({ ...input.metadata }),
  });
}
