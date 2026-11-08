/* Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { createGeneratedMediaArtifact } from "@noobot/model-protocol";
import { TIME_THRESHOLDS } from "@noobot/shared/time-thresholds";
import { assertResponseMode } from "./response-mode.js";

function generationUrl(baseUrl, path) {
  const base = new URL(baseUrl);
  const prefix = base.pathname.replace(/\/$/, "");
  base.pathname = `${prefix}/${path}`;
  base.search = "";
  base.hash = "";
  return base.toString();
}

function generationError(message, details = {}) {
  return Object.assign(new Error(message), details);
}

export async function generationRequest(context, path, body, extraHeaders = {}) {
  context.signal.throwIfAborted();
  const url = generationUrl(context.modelSpec.base_url, path);
  const method = body === undefined ? "GET" : "POST";
  const multipart = body instanceof FormData;
  const headers = { ...context.headers, ...extraHeaders };
  if (body !== undefined && !multipart) headers["Content-Type"] = "application/json";
  try {
    const response = await context.fetch(url, {
      method,
      headers,
      signal: context.signal,
      ...(body === undefined ? {} : { body: multipart ? body : JSON.stringify(body) }),
    });
    if (!response.ok)
      throw generationError(`HTTP ${response.status}: ${await response.text()}`, {
        status: response.status,
      });
    await assertResponseMode({ requestedStreaming: false, response });
    const payload = await response.json();
    if (payload.error)
      throw generationError(`generation API error: ${JSON.stringify(payload.error)}`, {
        status: response.status,
      });
    return payload;
  } catch (error) {
    error.requestUrl = url;
    error.requestMethod = method;
    throw error;
  }
}

async function generationPause({ clock, signal }) {
  signal.throwIfAborted();
  const { promise: aborted, reject } = Promise.withResolvers();
  const onAbort = () => reject(signal.reason);
  signal.addEventListener("abort", onAbort, { once: true });
  try {
    await Promise.race([clock.sleep(TIME_THRESHOLDS.model.generationPollIntervalMs), aborted]);
  } finally {
    signal.removeEventListener("abort", onAbort);
  }
}

async function readGenerationTask(context, { id, path, read, initial }) {
  let payload = initial;
  while (true) {
    context.signal.throwIfAborted();
    payload ??= await generationRequest(context, path);
    const state = read(payload);
    if (state.done) return { payload, taskId: id };
    if (state.failed) throw generationError(state.message || "generation task failed");
    if (!state.pending) throw new TypeError(`unknown generation task status: ${state.status}`);
    await generationPause(context);
    payload = undefined;
  }
}

export async function pollGeneration(context, task) {
  if (!task.id) throw new TypeError("generation response requires a task ID");
  try {
    return await readGenerationTask(context, task);
  } catch (error) {
    error.taskId = task.id;
    throw error;
  }
}

export function generationArtifact({ kind, data = "", url = "", mimeType, index = 0 }) {
  return createGeneratedMediaArtifact({
    outputType: kind,
    contentBase64: data,
    url,
    mimeType,
    index,
  });
}

export function generationResult(kind, artifacts, extra = {}) {
  if (!artifacts.length) throw new TypeError(`native ${kind} generation returned no media`);
  return { rawText: "", artifacts, taskId: "", ...extra };
}

export function requireGenerationOptions(options, allowed, label) {
  const supported = new Set(allowed);
  for (const [key, value] of Object.entries(options)) {
    if (supported.has(key)) continue;
    if (value === "" || value === undefined || (key === "n" && value === 1)) continue;
    if (Array.isArray(value) && !value.length) continue;
    throw new TypeError(`${label} does not support option: ${key}`);
  }
}
