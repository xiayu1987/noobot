/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { isFunction } from "@noobot/shared/value";
import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import { QUANTITY_THRESHOLDS } from "@noobot/shared/quantity-thresholds";
import { TIME_THRESHOLDS } from "@noobot/shared/time-thresholds";
import {
  decodeSessionPageSnapshotCursor,
  encodeSessionPageSnapshotCursor,
  requirePageSnapshotPolicy,
  sessionPageMatchesDeletedSessions,
  sessionPageSnapshotError,
  sessionPageWorkspaceScope,
} from "@noobot/session-protocol/message-read-budget";
import { withStorageCleanup } from "../shared/storage/durable-file.js";
import { logger } from "../observability/console/logger.js";

function matchesScope(identity, scope) {
  return scope.length <= identity.length && scope.every((part, index) => identity[index] === part);
}

export class SessionPageSnapshots {
  constructor({
    limits = {
      readers: QUANTITY_THRESHOLDS.sessionPageSnapshots.readers,
      idleMs: TIME_THRESHOLDS.sessionPageSnapshots.idleMs,
      maxAgeMs: TIME_THRESHOLDS.sessionPageSnapshots.maxAgeMs,
    },
    now = () => performance.now(),
  } = {}) {
    if (!isFunction(now)) throw new TypeError("Page snapshots require a clock");
    this.limits = Object.freeze({ ...requirePageSnapshotPolicy(limits) });
    this.now = now;
    this.entries = new Map();
    this.timer = null;
    this.closing = false;
    this.completion = null;
  }

  findReleaseFailure(scope) {
    for (const entry of this.entries.values()) {
      if (entry.releaseFailure !== null && matchesScope(entry.identity, scope))
        return entry.releaseFailure;
    }
    return null;
  }

  scheduledReaders() {
    return [...this.entries].filter(([, entry]) => entry.active === 0 && entry.completion === null);
  }

  schedule() {
    clearTimeout(this.timer);
    this.timer = null;
    if (this.closing) return;
    const scheduled = this.scheduledReaders();
    if (!scheduled.length) return;
    const delay = Math.max(
      1,
      Math.min(...scheduled.map(([, entry]) => entry.expiresAt)) - this.now(),
    );
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.retireExpired();
    }, delay);
    this.timer.unref();
  }

  async release(token, entry, retirement) {
    if (retirement === "revoked") entry.retirement = retirement;
    if (!entry.completion) {
      entry.retirement ??= retirement;
      entry.completion = (async () => {
        if (entry.active)
          await new Promise((resolve) => {
            entry.drained = resolve;
          });
        if (entry.reader) await entry.reader.close();
        this.entries.delete(token);
        this.schedule();
      })().catch((cause) => {
        const firstFailure = entry.releaseFailure === null;
        entry.completion = null;
        entry.releaseFailure = { cause };
        entry.expiresAt = this.now() + this.limits.idleMs;
        this.schedule();
        if (firstFailure) logger.error("[session_page_snapshot][release_failed]", { err: cause });
        throw cause;
      });
    }
    return entry.completion;
  }

  async releaseCursor({ identity, cursor }) {
    const { token } = decodeSessionPageSnapshotCursor(cursor);
    const entry = this.entries.get(token);
    if (!entry) return { released: false };
    if (entry.identity.length !== identity.length || !matchesScope(entry.identity, identity))
      throw sessionPageSnapshotError("expired");
    await this.release(token, entry, "revoked");
    return { released: true };
  }

  async releaseScopes(scopes) {
    return this.releaseMatching((identity) =>
      scopes.some((scope) => matchesScope(identity, scope)),
    );
  }

  async releaseDeletedSessions(selection) {
    return this.releaseMatching((identity) =>
      sessionPageMatchesDeletedSessions(identity, selection),
    );
  }

  async releaseMatching(matches) {
    const results = await Promise.allSettled(
      [...this.entries]
        .filter(([, entry]) => matches(entry.identity))
        .map(([token, entry]) => this.release(token, entry, "revoked")),
    );
    const failures = results
      .filter((result) => result.status === "rejected")
      .map((result) => result.reason);
    if (failures.length) throw new AggregateError(failures, "Page snapshot scope release failed");
  }

  async retireExpired() {
    const now = this.now();
    const releases = this.scheduledReaders()
      .filter(([, entry]) => entry.expiresAt <= now)
      .map(([token, entry]) => this.release(token, entry, "draining"));
    this.schedule();
    const results = await Promise.allSettled(releases);
    return results.filter((result) => result.status === "rejected").map((result) => result.reason);
  }

  async expire() {
    const failures = await this.retireExpired();
    if (failures.length) throw new AggregateError(failures, "Page snapshot expiry failed");
  }

  #assertPageReadable(entry) {
    if (entry.retirement === "revoked" || entry.deadline <= this.now())
      throw sessionPageSnapshotError("expired");
  }

  withReadAuthority(assertReadAuthority) {
    return {
      read: (selection) => this.read({ ...selection, assertReadAuthority }),
      releaseCursor: (selection) => this.releaseCursor(selection),
    };
  }

  async read({ identity, cursor, open, read, validate, assertReadAuthority }) {
    if (!isFunction(assertReadAuthority))
      throw new TypeError("Session page reads require a storage authority check");
    if (this.closing) throw sessionPageSnapshotError("closed");
    const failure = this.findReleaseFailure(sessionPageWorkspaceScope(identity[0]));
    if (failure !== null) throw failure.cause;
    const decoded = cursor === null ? null : decodeSessionPageSnapshotCursor(cursor);
    const token = decoded === null ? randomUUID() : decoded.token;
    let entry = this.entries.get(token);
    if (
      decoded !== null &&
      (!entry ||
        entry.identity.length !== identity.length ||
        !matchesScope(entry.identity, identity) ||
        entry.retirement !== null ||
        entry.deadline <= this.now() ||
        (entry.active === 0 && entry.expiresAt <= this.now()))
    )
      throw sessionPageSnapshotError("expired");
    if (decoded === null) {
      if (this.entries.size >= this.limits.readers) throw sessionPageSnapshotError("capacity");
      entry = {
        identity: [...identity],
        reader: null,
        active: 0,
        expiresAt: Infinity,
        deadline: this.now() + this.limits.maxAgeMs,
        retirement: null,
        completion: null,
        drained: null,
        releaseFailure: null,
      };
      this.entries.set(token, entry);
    }
    entry.active += 1;
    let retained = false;
    const page = await withStorageCleanup(
      async () => {
        try {
          if (decoded === null) {
            entry.reader = await open();
          }
          this.#assertPageReadable(entry);
          await assertReadAuthority(entry.reader);
          this.#assertPageReadable(entry);
          const response = await read(entry.reader, decoded === null ? null : decoded.cursor);
          this.#assertPageReadable(entry);
          await assertReadAuthority(entry.reader);
          this.#assertPageReadable(entry);
          if (response === null || response.nextCursor === null) {
            validate?.(response);
            return response;
          }
          if (entry.retirement !== null) throw sessionPageSnapshotError("expired");
          const nextCursor = encodeSessionPageSnapshotCursor(token, response.nextCursor);
          const page = { ...response, nextCursor };
          validate?.(page);
          retained = true;
          return page;
        } finally {
          entry.active -= 1;
          entry.expiresAt = Math.min(entry.deadline, this.now() + this.limits.idleMs);
          if (!entry.active) entry.drained?.();
        }
      },
      async () => {
        if (!retained) await this.release(token, entry, "draining");
      },
    );
    if (entry.retirement === "revoked") throw sessionPageSnapshotError("expired");
    if (entry.deadline <= this.now()) {
      if (retained)
        return withStorageCleanup(
          () => {
            throw sessionPageSnapshotError("expired");
          },
          () => this.release(token, entry, "draining"),
        );
      throw sessionPageSnapshotError("expired");
    }
    if (retained) this.schedule();
    return page;
  }

  close() {
    this.closing = true;
    clearTimeout(this.timer);
    if (!this.completion)
      this.completion = (async () => {
        const results = await Promise.allSettled(
          [...this.entries].map(([token, entry]) => this.release(token, entry, "draining")),
        );
        const failures = results
          .filter((result) => result.status === "rejected")
          .map((result) => result.reason);
        if (failures.length) throw new AggregateError(failures, "Page snapshot shutdown failed");
      })().catch((cause) => {
        this.completion = null;
        throw cause;
      });
    return this.completion;
  }

  [Symbol.asyncDispose]() {
    return this.close();
  }
}
