/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { randomUUID } from "node:crypto";
import { createModelRequestExecutor } from "@noobot/model-runtime";
import {
  MODEL_ERROR_CODE,
  MODEL_ERROR_KIND,
  ModelProtocolError,
  requireModelPort,
  requireModelSpec,
} from "@noobot/model-protocol";
import { emitEvent } from "../events/index.js";

function resolveCredential(modelSpec = {}) {
  return String(modelSpec.api_key || "").trim();
}

function createCredentialPort() {
  return Object.freeze({
    async resolve({ modelSpec }) {
      const apiKey = resolveCredential(modelSpec || {});
      if (!apiKey) {
        throw new ModelProtocolError(
          `model credential missing: ${modelSpec?.alias || modelSpec?.model || "unknown"}`,
          {
            code: MODEL_ERROR_CODE.CREDENTIAL_MISSING,
            kind: MODEL_ERROR_KIND.AUTHENTICATION,
            details: { alias: modelSpec?.alias || "", model: modelSpec?.model || "" },
          },
        );
      }
      return apiKey;
    },
  });
}

function createObservationPort({ modelState }) {
  return Object.freeze({
    emit(type, payload = {}) {
      emitEvent(modelState.eventListener, type, payload);
    },
  });
}

function buildInvocation(modelState, request = {}) {
  const baseIdentity = modelState.invocationIdentity;
  if (!baseIdentity || typeof baseIdentity !== "object") {
    throw new TypeError("model host requires an explicit invocationIdentity");
  }
  const identity = request.invocation || {};
  for (const field of ["sessionId", "parentSessionId", "dialogProcessId", "turnScopeId", "runId"]) {
    const requestedValue = String(identity[field] || "").trim();
    const hostValue = String(baseIdentity[field] || "").trim();
    if (requestedValue && requestedValue !== hostValue) {
      throw new TypeError(`model invocation.${field} conflicts with host identity`);
    }
  }
  return {
    requestId: identity.requestId || randomUUID(),
    invocationId: identity.invocationId || randomUUID(),
    sessionId: String(baseIdentity.sessionId || "").trim(),
    parentSessionId: String(baseIdentity.parentSessionId || "").trim(),
    dialogProcessId: String(baseIdentity.dialogProcessId || "").trim(),
    turnScopeId: String(baseIdentity.turnScopeId || "").trim(),
    runId: String(baseIdentity.runId || "").trim(),
    flow: String(identity.flow || "").trim(),
    purpose: String(identity.purpose || "").trim(),
    domain: String(identity.domain || "").trim(),
    contextSequencePolicy: String(identity.contextSequencePolicy || "").trim(),
  };
}

export function createModelPort({ modelSpec, modelState = {} } = {}) {
  const executor = createModelRequestExecutor({
    credentialPort: createCredentialPort(),
    observationPort: createObservationPort({ modelState }),
  });
  const port = {
    async invoke({
      model,
      messages = [],
      tools = [],
      options = {},
      policies = {},
      invocation,
      operation,
    } = {}) {
      const requestModelSpec = requireModelSpec(
        model || modelState.activeModelSpec || modelState.defaultModelSpec || modelSpec,
      );
      const response = await executor.invoke({
        model: requestModelSpec,
        operation,
        messages,
        tools,
        options,
        policies,
        metadata: {
          context: {
            summaryCheckpointRevision: Math.max(
              0,
              Number(modelState.runtime?.summaryCheckpointRevision) || 0,
            ),
          },
        },
        invocation: buildInvocation(modelState, { invocation }),
      });
      return response;
    },
  };
  return requireModelPort(Object.freeze(port));
}

export function createAgentModelPort(modelState) {
  return createModelPort({ modelState });
}

export function createAgentAuxiliaryModelPort({ modelSpec, modelState } = {}) {
  return createModelPort({ modelSpec, modelState });
}

export function attachAgentModelPort(modelState) {
  modelState.modelPort = createAgentModelPort(modelState);
  return modelState.modelPort;
}
