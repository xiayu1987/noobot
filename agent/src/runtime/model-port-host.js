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
import { resolveEffectiveModelSpec } from "./run-config/index.js";
import { text, isObjectLike, isPlainObject } from "@noobot/shared/value";

function resolveCredential(modelSpec = {}) {
  return text(modelSpec.api_key);
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
  if (!isObjectLike(baseIdentity)) {
    throw new TypeError("model host requires an explicit invocationIdentity");
  }
  const identity = request.invocation || {};
  for (const field of ["sessionId", "parentSessionId", "dialogProcessId", "turnScopeId", "runId"]) {
    const requestedValue = text(identity[field]);
    const hostValue = text(baseIdentity[field]);
    if (requestedValue && requestedValue !== hostValue) {
      throw new TypeError(`model invocation.${field} conflicts with host identity`);
    }
  }
  return {
    requestId: identity.requestId || randomUUID(),
    invocationId: identity.invocationId || randomUUID(),
    sessionId: text(baseIdentity.sessionId),
    parentSessionId: text(baseIdentity.parentSessionId),
    dialogProcessId: text(baseIdentity.dialogProcessId),
    turnScopeId: text(baseIdentity.turnScopeId),
    runId: text(baseIdentity.runId),
    flow: text(identity.flow),
    purpose: text(identity.purpose),
    domain: text(identity.domain),
    contextSequencePolicy: text(identity.contextSequencePolicy),
  };
}

function createModelPort({ resolveTurnModelSpec, modelState }) {
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
      const requestModelSpec = requireModelSpec(model || resolveTurnModelSpec());
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

function createAgentModelPort(modelState) {
  return createModelPort({
    modelState,
    resolveTurnModelSpec: () => modelState.activeModelSpec,
  });
}

export function createAgentAuxiliaryModelPort({ modelSpec, modelState }) {
  const auxiliaryModelSpec = requireModelSpec(modelSpec);
  return createModelPort({ modelState, resolveTurnModelSpec: () => auxiliaryModelSpec });
}

export function initializeAgentModelHost({
  runtime,
  invocationIdentity,
  resolveModelSpec = resolveEffectiveModelSpec,
} = {}) {
  if (!isPlainObject(runtime)) {
    throw new TypeError("agent model host requires runtime");
  }
  const identity = Object.freeze({
    sessionId: text(invocationIdentity?.sessionId),
    parentSessionId: text(invocationIdentity?.parentSessionId),
    dialogProcessId: text(invocationIdentity?.dialogProcessId),
    turnScopeId: text(invocationIdentity?.turnScopeId),
    runId: text(invocationIdentity?.runId),
  });
  for (const field of ["sessionId", "dialogProcessId", "turnScopeId", "runId"]) {
    if (!identity[field]) throw new TypeError(`agent model host identity.${field} is required`);
  }

  const existing = runtime.modelHost;
  if (existing) {
    for (const field of Object.keys(identity)) {
      if (text(existing.invocationIdentity?.[field]) !== identity[field]) {
        throw new TypeError(`agent model host identity.${field} conflict`);
      }
    }
    return existing;
  }

  const globalConfig = runtime.globalConfig || {};
  const userConfig = runtime.userConfig || {};
  const runConfig = runtime.runConfig || {};
  const modelSpec = resolveModelSpec({
    globalConfig,
    userConfig,
    selectedModel: runConfig.selectedModel,
    scenario: runConfig.scenario,
  });
  const modelState = {
    activeModelSpec: modelSpec,
    defaultModelSpec: modelSpec,
    eventListener: runtime.eventListener || null,
    runtime,
    globalConfig,
    userConfig,
    abortSignal: runtime.abortSignal || null,
    invocationIdentity: identity,
  };
  const modelPort = createAgentModelPort(modelState);
  modelState.modelPort = modelPort;
  const host = Object.freeze({
    modelSpec,
    modelPort,
    modelState,
    invocationIdentity: identity,
  });
  runtime.modelHost = host;
  runtime.modelPort = modelPort;
  runtime.modelSpec = modelSpec;
  emitEvent(runtime.eventListener, "model_selected", {
    alias: modelSpec?.alias || "",
    model: modelSpec?.model || "",
  });
  return host;
}
