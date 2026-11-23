/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { describe, expect, it, vi } from "vitest";
import { effectScope, nextTick, ref } from "vue";
import { useThinkingDetailPagination } from "../../../../../src/modules/chat/composables/thinkingDetailPagination.js";

function deferred() {
  let resolve;
  const promise = new Promise((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

function fixture(fetchPage, releasePage = vi.fn().mockResolvedValue({ released: true })) {
  const target = ref({ key: "s:t:d", sessionId: "s", turnScopeId: "t", dialogProcessId: "d" });
  const detail = ref(null);
  const scope = effectScope();
  const pagination = scope.run(() =>
    useThinkingDetailPagination({
      identity: () => target.value,
      detail,
      getReader: () => ({ fetchPage, releasePage }),
    }),
  );
  return { target, detail, scope, pagination, releasePage };
}

const first = {
  messageItem: { content: "first" },
  page: { generation: 2, messageCount: 2, after: 0, count: 1, nextCursor: { after: 1 } },
};
const last = {
  messageItem: { content: "last" },
  page: { generation: 2, messageCount: 2, after: 1, count: 1, nextCursor: null },
};

describe("thinking detail pagination lifecycle", () => {
  it("replaces the previous body and carries the published snapshot only on continuation", async () => {
    const fetchPage = vi.fn().mockResolvedValueOnce(first).mockResolvedValueOnce(last);
    const { pagination, detail, scope } = fixture(fetchPage);
    try {
      await pagination.restart();
      await pagination.next();
      expect(fetchPage.mock.calls[0][0]).toMatchObject({ cursor: null, snapshot: null });
      expect(fetchPage.mock.calls[1][0]).toMatchObject({
        cursor: first.page.nextCursor,
        snapshot: first.page,
      });
      expect(detail.value.messageItem).toEqual(last.messageItem);
      await pagination.next();
      expect(fetchPage).toHaveBeenCalledTimes(2);
    } finally {
      scope.stop();
    }
  });

  it("does not invalidate an in-flight page when the same identity object is replaced", async () => {
    const pending = deferred();
    const { pagination, detail, target, scope } = fixture(() => pending.promise);
    try {
      const request = pagination.restart();
      target.value = { ...target.value };
      await nextTick();
      pending.resolve(first);
      await request;
      expect(detail.value.messageItem).toEqual(first.messageItem);
    } finally {
      scope.stop();
    }
  });

  it("clears the previous identity and ignores its late response", async () => {
    const pending = deferred();
    const fetchPage = vi.fn().mockResolvedValueOnce(first).mockReturnValueOnce(pending.promise);
    const { pagination, detail, target, scope } = fixture(fetchPage);
    try {
      await pagination.restart();
      const request = pagination.next();
      target.value = { ...target.value, key: "s:new:d", turnScopeId: "new" };
      expect(detail.value).toBeNull();
      expect(pagination.page.value).toBeNull();
      pending.resolve(last);
      await request;
      expect(detail.value).toBeNull();
    } finally {
      scope.stop();
    }
  });

  it("publishes continuation errors and restarts explicitly without an automatic retry", async () => {
    const conflict = new Error("snapshot changed");
    const fetchPage = vi
      .fn()
      .mockResolvedValueOnce(first)
      .mockRejectedValueOnce(conflict)
      .mockResolvedValueOnce(last);
    const { pagination, detail, scope } = fixture(fetchPage);
    try {
      await pagination.restart();
      await pagination.next();
      expect(pagination.error.value).toBe(conflict);
      expect(detail.value.messageItem).toEqual(first.messageItem);
      expect(fetchPage).toHaveBeenCalledTimes(2);
      await pagination.restart();
      expect(fetchPage.mock.calls[2][0]).toMatchObject({ cursor: null, snapshot: null });
      expect(pagination.error.value).toBeNull();
    } finally {
      scope.stop();
    }
  });

  it("releases the abandoned snapshot on identity change with its original identity", async () => {
    const { pagination, target, releasePage, scope } = fixture(vi.fn().mockResolvedValue(first));
    await pagination.restart();
    target.value = { key: "other", sessionId: "other", turnScopeId: "new", dialogProcessId: "new" };
    await nextTick();
    expect(releasePage).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: "s", turnScopeId: "t", cursor: first.page.nextCursor }),
    );
    scope.stop();
  });

  it("releases a late first page after disposal", async () => {
    const pending = deferred();
    const { pagination, scope, releasePage } = fixture(() => pending.promise);
    const request = pagination.restart();
    scope.stop();
    pending.resolve(first);
    await request;
    expect(releasePage).toHaveBeenCalledTimes(1);
  });

  it("reports a late response release failure and retries it before a new snapshot", async () => {
    const pending = deferred();
    const failure = new Error("release failed");
    const releasePage = vi
      .fn()
      .mockRejectedValueOnce(failure)
      .mockResolvedValue({ released: true });
    const fetchPage = vi.fn().mockReturnValueOnce(pending.promise).mockResolvedValue(last);
    const { pagination, scope } = fixture(fetchPage, releasePage);
    const request = pagination.restart();
    await pagination.invalidate();
    pending.resolve(first);
    await request;
    expect(pagination.error.value).toBe(failure);
    await pagination.restart();
    expect(releasePage).toHaveBeenCalledTimes(2);
    expect(fetchPage).toHaveBeenCalledTimes(2);
    scope.stop();
  });

  it("drains a late snapshot before admitting a new identity", async () => {
    const pending = deferred();
    const releasing = deferred();
    const fetchPage = vi.fn().mockReturnValueOnce(pending.promise).mockResolvedValue(last);
    const releasePage = vi.fn(() => releasing.promise);
    const { pagination, target, detail, scope } = fixture(fetchPage, releasePage);
    try {
      const oldRequest = pagination.restart();
      target.value = {
        key: "other",
        sessionId: "other",
        turnScopeId: "new",
        dialogProcessId: "new",
      };
      const newRequest = pagination.restart();
      expect(fetchPage).toHaveBeenCalledTimes(1);
      pending.resolve(first);
      await vi.waitFor(() => expect(releasePage).toHaveBeenCalledTimes(1));
      expect(fetchPage).toHaveBeenCalledTimes(1);
      expect(releasePage).toHaveBeenCalledWith(
        expect.objectContaining({ sessionId: "s", turnScopeId: "t" }),
      );
      releasing.resolve({ released: true });
      await Promise.all([oldRequest, newRequest]);
      expect(fetchPage).toHaveBeenCalledTimes(2);
      expect(fetchPage.mock.calls[1][0]).toMatchObject({ sessionId: "other", turnScopeId: "new" });
      expect(detail.value.messageItem).toEqual(last.messageItem);
    } finally {
      scope.stop();
    }
  });

  it("blocks new snapshots while a late release keeps failing", async () => {
    const pending = deferred();
    const failure = new Error("release unavailable");
    const releasePage = vi.fn().mockRejectedValue(failure);
    const fetchPage = vi.fn().mockReturnValueOnce(pending.promise).mockResolvedValue(last);
    const { pagination, target, scope } = fixture(fetchPage, releasePage);
    try {
      const oldRequest = pagination.restart();
      target.value = {
        key: "other",
        sessionId: "other",
        turnScopeId: "new",
        dialogProcessId: "new",
      };
      const newRequest = pagination.restart();
      pending.resolve(first);
      await Promise.all([oldRequest, newRequest]);
      expect(fetchPage).toHaveBeenCalledTimes(1);
      expect(pagination.error.value).toBeInstanceOf(AggregateError);
      await pagination.restart();
      expect(fetchPage).toHaveBeenCalledTimes(1);
      releasePage.mockResolvedValue({ released: true });
      await pagination.restart();
      expect(fetchPage).toHaveBeenCalledTimes(2);
    } finally {
      scope.stop();
    }
  });

  it("does not open another snapshot after disposal", async () => {
    const fetchPage = vi.fn().mockResolvedValue(first);
    const { pagination, scope } = fixture(fetchPage);
    scope.stop();
    await pagination.restart();
    expect(fetchPage).not.toHaveBeenCalled();
  });

  it("invalidates pending results on close and prevents duplicate page requests", async () => {
    const pending = deferred();
    const fetchPage = vi.fn(() => pending.promise);
    const { pagination, detail, scope } = fixture(fetchPage);
    const request = pagination.restart();
    await pagination.restart();
    expect(fetchPage).toHaveBeenCalledTimes(1);
    scope.stop();
    pending.resolve(first);
    await request;
    expect(detail.value).toBeNull();
    expect(pagination.loading.value).toBe(false);
  });
});
