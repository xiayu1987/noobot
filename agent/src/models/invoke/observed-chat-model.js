/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { randomUUID } from "node:crypto";
import { summarizeDiagnosticMessages } from "@noobot/context-protocol/context-diagnostics";
import { emitModelContextTrace } from "../../observability/model-context-trace-emitter.js";

const OBSERVED_MODEL = Symbol("noobot.observed-model");

function requireMessageArray(input) {
  if (!Array.isArray(input)) {
    throw new TypeError("model invocation input must be a message array");
  }
  return input;
}

function bindMethod(target, property) {
  const value = Reflect.get(target, property, target);
  return typeof value === "function" ? value.bind(target) : value;
}

export function createObservedChatModel(model, {
  runtime = null,
  modelSpec = {},
  invocation = {},
  streaming = false,
  state = null,
  boundToolCount = 0,
} = {}) {
  if (!model || typeof model.invoke !== "function") {
    throw new TypeError("observed chat model requires an invokable model");
  }
  if (model[OBSERVED_MODEL] === true) return model;

  const observationState = state || { modelInstanceId: randomUUID(), sequence: 0 };
  return new Proxy(model, {
    get(target, property) {
      if (property === OBSERVED_MODEL) return true;
      if (property === "invoke") {
        return async (...args) => {
          const input = args[0];
          const messages = requireMessageArray(input);
          observationState.sequence += 1;
          emitModelContextTrace(runtime, "llm_invoke_messages", {
            protocolVersion: 1,
            authority: "model_invoke_port",
            modelInstanceId: observationState.modelInstanceId,
            invocationId: randomUUID(),
            invocationSequence: observationState.sequence,
            model: {
              alias: String(modelSpec?.alias || "").trim(),
              name: String(modelSpec?.model || "").trim(),
              format: String(modelSpec?.format || "").trim(),
              streaming: streaming === true,
              boundToolCount: Number(boundToolCount || 0),
            },
            invocation: {
              flow: String(invocation?.flow || "").trim(),
              purpose: String(invocation?.purpose || "").trim(),
              domain: String(invocation?.domain || "").trim(),
            },
            messages: summarizeDiagnosticMessages(messages),
          });
          return target.invoke(...args);
        };
      }
      if (property === "bindTools" && typeof target.bindTools === "function") {
        return (...args) => createObservedChatModel(
          target.bindTools(...args),
          {
            runtime,
            modelSpec,
            invocation,
            streaming,
            state: observationState,
            boundToolCount: Array.isArray(args[0]) ? args[0].length : 0,
          },
        );
      }
      if (property === "then") return undefined;
      return bindMethod(target, property);
    },
    set(target, property, value) {
      return Reflect.set(target, property, value, target);
    },
  });
}
