/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { randomUUID } from "node:crypto";
import { createModelRequestExecutor } from "@noobot/model-runtime";
import {
  MODEL_ERROR_CODE,
  MODEL_CONTEXT_SEQUENCE_POLICY,
  MODEL_ERROR_KIND,
  ModelProtocolError,
  requireInvocationScope,
  requireModelPort,
  requireModelSpec,
  validateModelResponse,
} from "@noobot/model-protocol";
import { emitEvent } from "../events/index.js";
import { resolveEffectiveModelSpec } from "./run-config/index.js";
import { applyActiveModelSpec } from "../models/runtime/model-manager.js";
import { projectToolsForModel } from "../models/tool/model-tool-definition.js";
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
      emitEvent(modelState.runtime.eventListener, type, payload);
    },
  });
}

const CALLER_INVOCATION_FIELDS = new Set(["flow", "purpose", "domain", "contextSequencePolicy"]);

function buildInvocation(modelState, invocation) {
  if (!isPlainObject(invocation)) throw new TypeError("model invocation must be an object");
  for (const field of Object.keys(invocation)) {
    if (!CALLER_INVOCATION_FIELDS.has(field)) {
      throw new TypeError(`model invocation.${field} is owned by the model host`);
    }
  }
  return {
    requestId: randomUUID(),
    invocationId: randomUUID(),
    ...modelState.invocationIdentity,
    flow: invocation.flow,
    purpose: invocation.purpose,
    domain: invocation.domain,
    contextSequencePolicy: invocation.contextSequencePolicy,
  };
}

function buildRequestMetadata(modelState, invocation) {
  if (invocation.contextSequencePolicy !== MODEL_CONTEXT_SEQUENCE_POLICY.CHECKPOINT_APPEND_ONLY) {
    return undefined;
  }
  return {
    context: { summaryCheckpointRevision: modelState.runtime.summaryCheckpointRevision },
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
        tools: projectToolsForModel(tools, { strict: options?.toolBinding?.strict === true }),
        options,
        policies,
        metadata: buildRequestMetadata(modelState, invocation),
        invocation: buildInvocation(modelState, invocation),
      });
      return validateModelResponse(response);
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
  const auxiliaryModelState = {
    ...modelState,
    invocationIdentity: requireInvocationScope(
      modelState.invocationIdentity,
      "agent auxiliary model host identity",
    ),
  };
  return createModelPort({
    modelState: auxiliaryModelState,
    resolveTurnModelSpec: () => auxiliaryModelSpec,
  });
}

export function requireRuntimeModelHost(runtime) {
  const host = runtime?.modelHost;
  if (!isObjectLike(host)) throw new TypeError("runtime.modelHost is required");
  requireModelPort(host.modelPort);
  return host;
}

export function initializeAgentModelHost({ runtime, invocationIdentity }) {
  if (!isPlainObject(runtime)) {
    throw new TypeError("agent model host requires runtime");
  }
  const identity = requireInvocationScope(invocationIdentity, "agent model host identity");
  if (runtime.modelHost) {
    throw new TypeError("agent model host already initialized");
  }

  const { globalConfig, userConfig, runConfig } = runtime;
  const modelState = {
    defaultModelSpec: null,
    runtime,
    invocationIdentity: identity,
  };
  const modelSpec = applyActiveModelSpec(
    modelState,
    resolveEffectiveModelSpec({
      globalConfig,
      userConfig,
      selectedModel: runConfig.selectedModel,
      scenario: runConfig.scenario,
    }),
    { source: "model_host" },
  );
  modelState.defaultModelSpec = modelSpec;
  const modelPort = createAgentModelPort(modelState);
  modelState.modelPort = modelPort;
  const host = Object.freeze({
    modelSpec,
    modelPort,
    modelState,
    invocationIdentity: identity,
  });
  runtime.modelHost = host;
  emitEvent(runtime.eventListener, "model_selected", {
    alias: modelSpec.alias,
    model: modelSpec.model,
  });
  return host;
}
