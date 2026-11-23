/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { computed, onScopeDispose, ref, watch } from "vue";

export function useThinkingDetailPagination({ identity, detail, getReader }) {
  if (typeof getReader !== "function")
    throw new TypeError("Thinking detail pagination requires getReader");
  const loading = ref(false);
  const error = ref(null);
  let revision = 0;
  let retained = null;
  let activeRequest = null;
  let disposed = false;
  const abandoned = new Set();
  function release(owner) {
    abandoned.add(owner);
    if (owner.releasing !== null) return owner.releasing;
    owner.releasing = Promise.resolve()
      .then(() => owner.reader.releasePage(owner.selection))
      .then(() => {
        abandoned.delete(owner);
      })
      .catch((cause) => {
        owner.releasing = null;
        error.value = cause;
        throw cause;
      });
    return owner.releasing;
  }
  async function releaseRetained() {
    if (retained !== null) {
      abandoned.add(retained);
      retained = null;
    }
    const results = await Promise.allSettled([...abandoned].map(release));
    const failures = results
      .filter((result) => result.status === "rejected")
      .map((result) => result.reason);
    if (failures.length)
      throw new AggregateError(failures, "Thinking detail snapshot release failed");
  }
  const invalidate = () => {
    revision += 1;
    loading.value = false;
    error.value = null;
    return releaseRetained();
  };
  watch(
    () => identity()?.key ?? null,
    async () => {
      const released = invalidate();
      detail.value = null;
      try {
        await released;
      } catch (cause) {
        error.value = cause;
      }
    },
    { flush: "sync" },
  );
  onScopeDispose(() => {
    disposed = true;
    invalidate().catch((cause) => {
      error.value = cause;
    });
  });
  const page = computed(() => detail.value?.page ?? null);

  async function load(cursor) {
    if (disposed || loading.value) return;
    const target = identity();
    if (target === null) throw new TypeError("Thinking detail pagination requires a turn");
    const requestRevision = ++revision;
    const snapshot = cursor === null ? null : page.value;
    loading.value = true;
    error.value = null;
    const predecessor = activeRequest;
    let complete;
    const request = {
      done: new Promise((resolve) => {
        complete = resolve;
      }),
    };
    activeRequest = request;
    try {
      const reader = cursor === null ? getReader() : retained?.reader;
      if (typeof reader?.fetchPage !== "function" || typeof reader.releasePage !== "function")
        throw new TypeError("Thinking detail reader requires fetchPage and releasePage");
      if (predecessor !== null) await predecessor.done;
      if (requestRevision !== revision) return;
      if (cursor === null && (retained !== null || abandoned.size)) await releaseRetained();
      if (requestRevision !== revision) return;
      error.value = null;
      const selection = {
        sessionId: target.sessionId,
        dialogProcessId: target.dialogProcessId,
        turnScopeId: target.turnScopeId,
      };
      const result = await reader.fetchPage({ ...selection, cursor, snapshot });
      const capability =
        result.page.nextCursor === null
          ? null
          : {
              reader,
              selection: { ...selection, cursor: result.page.nextCursor },
              releasing: null,
            };
      if (requestRevision !== revision) {
        if (capability !== null) await release(capability);
        return;
      }
      retained = capability;
      detail.value = { ...result, __thinkingDetailIdentity: target };
    } catch (cause) {
      if (requestRevision === revision) error.value = cause;
    } finally {
      complete();
      if (activeRequest === request) activeRequest = null;
      if (requestRevision === revision) loading.value = false;
    }
  }

  return {
    page,
    loading,
    error,
    invalidate,
    restart: () => load(null),
    next: () => {
      if (page.value === null || page.value.nextCursor === null) return;
      return load(page.value.nextCursor);
    },
  };
}
