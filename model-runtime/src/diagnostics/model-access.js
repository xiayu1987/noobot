/* Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { randomUUID } from "node:crypto";
import { MODEL_CONTEXT_SEQUENCE_POLICY } from "@noobot/model-protocol";
import { createModelRequestExecutor } from "../executor/model-request-executor.js";
import { createProviderAdapterRegistry } from "../adapters/registry.js";
import { normalizeRuntimeModelSpec } from "../normalization/spec-normalizer.js";

const RESPONSE_LIMIT = 2 * 1024 * 1024;
const REDACTED = "[REDACTED]";
const SECRET_FIELD =
  /^(authorization|proxy-authorization|cookie|set-cookie|x-api-key|api[_-]?key|password|secret|access_token)$/i;

function normalizeDiagnosticTools(tools) {
  if (!Array.isArray(tools)) throw new TypeError("Tools must be an array / 工具定义必须是数组");
  return tools.map((tool) => {
    if (!tool || typeof tool !== "object" || Array.isArray(tool)) {
      throw new TypeError("Invalid tool definition / 工具定义无效");
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
  if (!value || typeof value !== "object") return value;
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
    chunks.push(Buffer.from(value.subarray(0, Math.max(0, RESPONSE_LIMIT - size))));
    size += value.byteLength;
    if (size > RESPONSE_LIMIT) {
      void reader.cancel().catch(() => undefined);
      break;
    }
  }
  return { body: Buffer.concat(chunks).toString("utf8"), truncated: size > RESPONSE_LIMIT };
}

export async function testModelAccess({
  modelSpec,
  messages = [{ role: "user", content: "Reply OK." }],
  body,
  tools,
  toolBinding,
  preview = false,
  signal,
  fetch: upstreamFetch = globalThis.fetch,
}) {
  const spec = normalizeRuntimeModelSpec(modelSpec);
  if (body !== undefined && (!body || typeof body !== "object" || Array.isArray(body))) {
    throw new TypeError("Request body must be a JSON object / 请求体必须是 JSON 对象");
  }
  const credential = String(spec.api_key || "").trim();
  if (!preview && (!credential || credential.includes("${"))) {
    throw new Error("Model credential is missing / 模型密钥未配置");
  }
  const started = performance.now();
  const traces = [];
  const responseReads = [];
  let captured = false;
  const transportFetch = async (url, options = {}) => {
    if (captured) throw new Error("Diagnostic allows one request / 每次测试只发送一次请求");
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
      createClient: (input) =>
        adapter.createClient({ ...input, fetch: transportFetch, maxRetries: 0 }),
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
      tools: normalizeDiagnosticTools(tools ?? body?.tools ?? []),
      options: {
        streaming: body?.stream === true,
        signal,
        toolBinding:
          toolBinding ?? (body?.tool_choice !== undefined ? { tool_choice: body.tool_choice } : {}),
      },
      policies: { retry: { transport: { maxAttempts: 1 } } },
      invocation: {
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
