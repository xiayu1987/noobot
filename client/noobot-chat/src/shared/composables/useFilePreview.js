/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { computed, ref } from "vue";
import { FILE_PREVIEW_URL_TYPES } from "@noobot/attachment-protocol/preview";

export function createFilePreviewState() {
  const state = {
    visible: ref(false),
    descriptor: ref({ name: "", type: "", language: "plaintext" }),
    url: ref(""),
    editable: ref(false),
    loading: ref(false),
    error: ref(""),
    textContent: ref(""),
  };
  state.name = computed(() => state.descriptor.value.name);
  let generation = 0;
  let request = null;
  let renewal = null;
  let objectUrl = null;
  function reset() {
    generation += 1;
    clearTimeout(renewal);
    renewal = null;
    request?.abort();
    request = null;
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    objectUrl = null;
    for (const key of ["url", "error", "textContent"]) state[key].value = "";
    state.descriptor.value = { name: "", type: "", language: "plaintext" };
    state.editable.value = false;
    state.visible.value = false;
    state.loading.value = false;
  }
  function publishText(content, editable, current) {
    if (current !== generation) return;
    state.textContent.value = content;
    state.editable.value = editable;
  }
  async function authorize(authorizeResource, current, signal) {
    const access = await authorizeResource(signal);
    if (current !== generation) return;
    if (!access.url || !Number.isFinite(access.expiresAt) || access.expiresAt <= Date.now())
      throw new Error("FILE_PREVIEW_RESOURCE_AUTHORIZATION_INVALID");
    state.url.value = access.url;
    renewal = setTimeout(
      async () => {
        try {
          await authorize(authorizeResource, current, signal);
        } catch (error) {
          if (current === generation) state.error.value = error.message;
        }
      },
      (access.expiresAt - Date.now()) / 2,
    );
  }
  async function load(source) {
    reset();
    const current = generation;
    request = new AbortController();
    state.visible.value = true;
    state.loading.value = true;
    try {
      const result = await source(request.signal);
      if (current !== generation) return;
      const { descriptor, readText, editable } = result;
      state.descriptor.value = descriptor;
      if (descriptor.overLimit) throw new Error("FILE_PREVIEW_TOO_LARGE");
      if (FILE_PREVIEW_URL_TYPES.has(descriptor.type)) {
        await loadResource(result, current, request.signal);
        return;
      }
      const content = await readText(request.signal);
      publishText(content, editable, current);
    } catch (error) {
      if (current === generation) state.error.value = error.message;
    } finally {
      if (current === generation) state.loading.value = false;
    }
  }
  async function loadResource({ descriptor, readBlob, authorizeResource }, current, signal) {
    if (readBlob && authorizeResource) throw new Error("FILE_PREVIEW_RESOURCE_SOURCE_AMBIGUOUS");
    if (!readBlob) {
      if (!authorizeResource) throw new Error("FILE_PREVIEW_RESOURCE_UNAVAILABLE");
      await authorize(authorizeResource, current, signal);
      return;
    }
    const blob = await readBlob(signal);
    if (current !== generation) return;
    if (blob.size > descriptor.maxBytes) throw new Error("FILE_PREVIEW_TOO_LARGE");
    objectUrl = URL.createObjectURL(blob);
    state.url.value = objectUrl;
  }
  return { state, reset, load };
}

export async function readFilePreviewText(response, descriptor) {
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const steps = readPreviewBlobSteps(response, descriptor.maxBytes);
  let step = await steps.next();
  while (!step.done) step = await steps.next();
  const blob = step.value;
  return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(
    await blob.arrayBuffer(),
  );
}

export async function readFilePreviewBlob(response, maxBytes, onBytes) {
  const steps = readPreviewBlobSteps(response, maxBytes);
  try {
    let step = await steps.next();
    while (!step.done) {
      onBytes(step.value);
      step = await steps.next();
    }
    return step.value;
  } finally {
    await steps.return();
  }
}

async function* readPreviewBlobSteps(response, maxBytes) {
  const declaredSize = response.headers?.get("content-length");
  if (declaredSize !== null && Number(declaredSize) > maxBytes) {
    await response.body?.cancel();
    throw new Error("FILE_PREVIEW_TOO_LARGE");
  }
  const reader = response.body?.getReader();
  if (!reader) {
    const blob = await response.blob();
    yield blob.size;
    if (blob.size > maxBytes) throw new Error("FILE_PREVIEW_TOO_LARGE");
    return blob;
  }
  try {
    const blob = yield* readPreviewChunks(reader, maxBytes);
    return new Blob([blob], { type: response.headers?.get("content-type") || "" });
  } finally {
    reader.releaseLock();
  }
}

async function* readPreviewChunks(reader, maxBytes) {
  const chunks = [];
  let bytes = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return new Blob(chunks);
    bytes += value.byteLength;
    yield bytes;
    if (bytes > maxBytes) {
      await reader.cancel();
      throw new Error("FILE_PREVIEW_TOO_LARGE");
    }
    chunks.push(value);
  }
}
