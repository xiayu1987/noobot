/* Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { LENGTH_THRESHOLDS } from "@noobot/shared/length-thresholds";
import { TURN_THRESHOLDS } from "@noobot/shared/turn-thresholds";
import { randomUUID } from "node:crypto";
import { MODEL_CONTEXT_SEQUENCE_POLICY } from "@noobot/model-protocol";
import { createModelRequestExecutor } from "../executor/model-request-executor.js";
import { createProviderAdapterRegistry } from "../adapters/registry.js";
import { normalizeRuntimeModelSpec } from "../normalization/spec-normalizer.js";
import { text, isPlainObject, isObjectLike } from "@noobot/shared/value";
import { tModelRuntime } from "../locale.js";

const REDACTED = "[REDACTED]";
const SECRET_FIELD =
  /^(authorization|proxy-authorization|cookie|set-cookie|x-api-key|api[_-]?key|password|secret|access_token)$/i;

function normalizeDiagnosticTools(tools, locale) {
  if (!Array.isArray(tools)) throw new TypeError(tModelRuntime(locale, "diagnostic.toolsArray"));
  return tools.map((tool) => {
    if (!isPlainObject(tool)) {
      throw new TypeError(tModelRuntime(locale, "diagnostic.invalidTool"));
    }
    if (tool.function || (tool.type && tool.type !== "function")) return tool;
    const { type, input_schema, ...definition } = tool;
    return {
      type: "function",
      function: { ...definition, ...(input_schema ? { parameters: input_schema } : {}) },
    };
  });
}

export function redactModelDiagnostic(value, secrets = []) {
  if (typeof value === "string") {
    return secrets
      .filter(Boolean)
      .reduce((result, secret) => result.replaceAll(secret, REDACTED), value);
  }
  if (Array.isArray(value)) return value.map((entry) => redactModelDiagnostic(entry, secrets));
  if (!isObjectLike(value)) return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [
      key,
      SECRET_FIELD.test(key) ? REDACTED : redactModelDiagnostic(entry, secrets),
    ]),
  );
}

async function readResponsePreview(response) {
  const reader = response.body?.getReader();
  if (!reader) return { body: "", truncated: false };
  const chunks = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(
      Buffer.from(
        value.subarray(0, Math.max(0, LENGTH_THRESHOLDS.diagnostics.responseBytes - size)),
      ),
    );
    size += value.byteLength;
    if (size > LENGTH_THRESHOLDS.diagnostics.responseBytes) {
      void reader.cancel().catch(() => undefined);
      break;
    }
  }
  return {
    body: Buffer.concat(chunks).toString("utf8"),
    truncated: size > LENGTH_THRESHOLDS.diagnostics.responseBytes,
  };
}

export async function testModelAccess({
  modelSpec,
  messages = [{ role: "user", content: "Reply OK." }],
  body,
  tools,
  toolBinding,
  preview = false,
  signal,
  locale,
  fetch: upstreamFetch = globalThis.fetch,
}) {
  const spec = normalizeRuntimeModelSpec(modelSpec);
  if (body !== undefined && !isPlainObject(body)) {
    throw new TypeError(tModelRuntime(locale, "diagnostic.bodyObject"));
  }
  const credential = text(spec.api_key);
  if (!preview && (!credential || credential.includes("${"))) {
    throw new Error(tModelRuntime(locale, "diagnostic.credentialMissing"));
  }
  const started = performance.now();
  const traces = [];
  const responseReads = [];
  let captured = false;
  const transportFetch = async (url, options = {}) => {
    if (captured) throw new Error(tModelRuntime(locale, "diagnostic.oneRequest"));
    captured = true;
    const actualBody = body === undefined ? JSON.parse(options.body) : body;
    const request = {
      url: String(url),
      method: options.method || "POST",
      headers: Object.fromEntries(new Headers(options.headers)),
      body: actualBody,
    };
    const trace = { request };
    traces.push(trace);
    if (preview) throw new Error("diagnostic_preview_complete");
    const response = await upstreamFetch(url, {
      ...options,
      body: JSON.stringify(actualBody),
      signal: signal || options.signal,
    });
    trace.response = {
      status: response.status,
      statusText: response.statusText,
      headers: Object.fromEntries(response.headers),
      headersMs: Math.round(performance.now() - started),
    };
    responseReads.push(
      readResponsePreview(response.clone()).then(
        (content) => Object.assign(trace.response, content),
        (error) => {
          trace.response.readError = String(error.message);
        },
      ),
    );
    return response;
  };
  const adapters = createProviderAdapterRegistry()
    .list()
    .map((adapter) => ({
      ...adapter,
      createClient: (input) => adapter.createClient({ ...input, fetch: transportFetch }),
    }));
  const executor = createModelRequestExecutor({
    registry: createProviderAdapterRegistry(adapters),
    credentialPort: { resolve: async () => credential || "diagnostic-preview" },
  });
  const identity = `model-access-${randomUUID()}`;
  let output;
  let failure;
  try {
    const result = await executor.invoke({
      model: spec,
      messages,
      tools: normalizeDiagnosticTools(tools ?? body?.tools ?? [], locale),
      options: {
        locale,
        streaming: body?.stream === true,
        signal,
        toolBinding:
          toolBinding ?? (body?.tool_choice !== undefined ? { tool_choice: body.tool_choice } : {}),
      },
      policies: {
        retry: { transport: { maxAttempts: TURN_THRESHOLDS.model.diagnosticMaxAttempts } },
      },
      invocation: {
        requestId: randomUUID(),
        invocationId: randomUUID(),
        sessionId: identity,
        parentSessionId: "",
        dialogProcessId: identity,
        turnScopeId: identity,
        runId: identity,
        flow: "diagnostic.model_access",
        purpose: "model_access_test",
        domain: "diagnostic",
        contextSequencePolicy: MODEL_CONTEXT_SEQUENCE_POLICY.INDEPENDENT_REQUEST,
      },
    });
    output = result.output;
  } catch (error) {
    if (!preview || !captured)
      failure = { message: String(error.message), status: error.status || null };
  }
  await Promise.all(responseReads);
  return redactModelDiagnostic(
    {
      ok: !failure,
      preview,
      elapsedMs: Math.round(performance.now() - started),
      adapterId: spec.adapterId,
      traces,
      output,
      error: failure,
    },
    [credential],
  );
}
