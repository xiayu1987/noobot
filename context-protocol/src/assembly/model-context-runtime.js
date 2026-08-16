/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

const runtimeByDocument = new WeakMap();

function createStore() {
  return { messages: [], byId: new Map(), nextId: 1 };
}

export function attachModelContextRuntime(
  document,
  { onCanonicalMessageAdded = null, onMutationConsumed = null } = {},
) {
  if (!document || typeof document !== "object" || Array.isArray(document)) {
    throw new TypeError("model context runtime requires a document object");
  }
  if (runtimeByDocument.has(document)) {
    throw new Error("model context runtime is already attached");
  }
  const runtime = {
    revision: 0,
    messageStore: createStore(),
    onCanonicalMessageAdded:
      typeof onCanonicalMessageAdded === "function" ? onCanonicalMessageAdded : null,
    onMutationConsumed: typeof onMutationConsumed === "function" ? onMutationConsumed : null,
  };
  runtimeByDocument.set(document, runtime);
  return runtime;
}

export function getModelContextRuntime(document) {
  const runtime = document && typeof document === "object" ? runtimeByDocument.get(document) : null;
  if (!runtime) throw new Error("model context document has no attached runtime");
  return runtime;
}

export function resetModelContextMessageStore(document) {
  const runtime = getModelContextRuntime(document);
  runtime.messageStore = createStore();
  return runtime.messageStore;
}

export function getModelContextRevision(document) {
  return getModelContextRuntime(document).revision;
}

export function resolveCanonicalContextMessages(document) {
  return [...getModelContextRuntime(document).messageStore.messages];
}

export function commitModelContextRevision(document) {
  const runtime = getModelContextRuntime(document);
  runtime.revision += 1;
  return runtime.revision;
}
