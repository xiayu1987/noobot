/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { SessionPageSnapshots } from "../../src/session/session-page-snapshots.js";

export function deferred() {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

export function fixture(t, limits = { readers: 2, idleMs: 1000, maxAgeMs: 5000 }) {
  let now = 0;
  let generation = 1;
  const work = { opens: 0, closes: 0, reads: [] };
  const snapshots = new SessionPageSnapshots({ limits, now: () => now });
  t.after(() => snapshots.close());
  const identity = ["user", "session", "/session", "dialog", "turn"];
  const open = async () => {
    work.opens += 1;
    const version = generation;
    return {
      generation: version,
      async close() {
        work.closes += 1;
      },
    };
  };
  const read = async (reader, cursor) => {
    work.reads.push(cursor);
    return {
      generation: reader.generation,
      nextCursor: cursor === null ? { after: 1, scope: `snapshot-${reader.generation}` } : null,
    };
  };
  return {
    snapshots,
    work,
    identity,
    open,
    read,
    request: (cursor = null, change = {}) =>
      snapshots.read({
        identity,
        cursor,
        open,
        read,
        assertReadAuthority: async () => {},
        ...change,
      }),
    advance: (time) => {
      now = time;
    },
    write: () => {
      generation += 1;
    },
  };
}
