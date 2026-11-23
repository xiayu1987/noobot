/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs/promises";
import path from "node:path";
import { setImmediate } from "node:timers/promises";
import {
  flushRuntimeEvents,
  RUNTIME_EVENT_ERROR_CODE,
  withSessionEventRetirement,
  writeRuntimeEvent,
} from "../src/index.js";
import {
  markSessionDeleted,
  persistSession,
  tempRoot,
  readJsonl,
} from "./runtime-events-test-fixtures.js";
import { SESSION_CALLER } from "@noobot/shared/session-caller";
import { tryAcquireDescriptorLock } from "@noobot/platform-compatibility/descriptor-lock";
import { WORKSPACE_LAYOUT } from "@noobot/workspace-protocol/layout";
import { appendJsonLine } from "../src/transports/jsonl.js";

const event = {
  scope: "session",
  source: "service",
  category: "system",
  event: "flush.preparation.test",
  userId: "admin",
  sessionId: "registered",
};

async function registeredSession(t) {
  const root = await tempRoot();
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  return persistSession(root, "admin", {
    sessionId: event.sessionId,
    parentSessionId: "",
    caller: SESSION_CALLER.USER,
  });
}

test("directory retirement waits for admitted runtime events and rejects late publication", async (t) => {
  const root = await tempRoot();
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const workspacePath = path.join(root, event.userId);
  const sessionDir = await persistSession(root, event.userId, {
    sessionId: event.sessionId,
    parentSessionId: "",
    caller: SESSION_CALLER.USER,
  });
  const entered = Promise.withResolvers();
  const release = Promise.withResolvers();
  const writing = writeRuntimeEvent(event, {
    locationResolver: {
      async locateSessionScope() {
        entered.resolve();
        await release.promise;
        return { sessionDir };
      },
    },
  });
  let retiring;
  try {
    await Promise.race([entered.promise, writing]);
    await using handle = await fs.open(
      path.join(workspacePath, WORKSPACE_LAYOUT.SESSION_EVENT_PUBLICATION_LOCK_FILE),
      "r+",
    );
    assert.equal(await tryAcquireDescriptorLock(handle), false);
    await markSessionDeleted(root, event.userId, event.sessionId);
    retiring = withSessionEventRetirement(workspacePath, async () => {
      const result = await writing;
      assert.equal(result.ok, true);
      assert.equal((await readJsonl(result.file)).length, 1);
      await fs.rm(sessionDir, { recursive: true });
    });
  } finally {
    release.resolve();
  }
  await retiring;
  const late = await writeRuntimeEvent(event);
  assert.equal(late.deleted, true);
  await assert.rejects(fs.stat(sessionDir), { code: "ENOENT" });
});

test("runtime flush waits for location preparation and durable publication", async (t) => {
  const sessionDir = await registeredSession(t);
  const entered = Promise.withResolvers();
  const release = Promise.withResolvers();
  const writing = writeRuntimeEvent(event, {
    locationResolver: {
      async locateSessionScope() {
        entered.resolve();
        await release.promise;
        return { sessionDir };
      },
    },
  });
  await entered.promise;
  let completed = false;
  const flushing = flushRuntimeEvents().then(() => {
    completed = true;
  });
  try {
    await setImmediate();
    assert.equal(completed, false);
  } finally {
    release.resolve();
    await flushing;
  }
  const result = await writing;
  assert.equal(result.ok, true);
  assert.equal((await readJsonl(result.file))[0].event, event.event);
});

test("runtime flush waits for events admitted by transport receipts", async (t) => {
  const sessionDir = await registeredSession(t);
  const entered = Promise.withResolvers();
  const release = Promise.withResolvers();
  const transportWrite = appendJsonLine(path.join(sessionDir, "transport.jsonl"), {
    transport: true,
  });
  const writing = transportWrite.then(() =>
    writeRuntimeEvent(event, {
      locationResolver: {
        async locateSessionScope() {
          entered.resolve();
          await release.promise;
          return { sessionDir };
        },
      },
    }),
  );
  let completed = false;
  const flushing = flushRuntimeEvents().then(() => {
    completed = true;
  });
  try {
    await entered.promise;
    await setImmediate();
    assert.equal(completed, false);
  } finally {
    release.resolve();
    await flushing;
    await writing;
  }
});

test("runtime flush propagates preparation failure after settling admitted writes", async (t) => {
  const sessionDir = await registeredSession(t);
  const entered = Promise.withResolvers();
  const releaseFailure = Promise.withResolvers();
  const releaseSuccess = Promise.withResolvers();
  const failure = new Error("location authority unavailable");
  const failedWrite = writeRuntimeEvent(event, {
    locationResolver: {
      async locateSessionScope() {
        entered.resolve();
        await releaseFailure.promise;
        throw failure;
      },
    },
  });
  const successfulWrite = writeRuntimeEvent(event, {
    locationResolver: {
      async locateSessionScope() {
        await releaseSuccess.promise;
        return { sessionDir };
      },
    },
  });
  const rejectedWrite = assert.rejects(failedWrite, (error) => error === failure);
  await entered.promise;
  let settled = false;
  const rejectedFlush = assert.rejects(flushRuntimeEvents(), (error) => {
    settled = true;
    assert.ok(error instanceof AggregateError);
    assert.deepEqual(error.errors, [failure]);
    return true;
  });
  try {
    releaseFailure.resolve();
    await rejectedWrite;
    await setImmediate();
    assert.equal(settled, false);
  } finally {
    releaseSuccess.resolve();
    await rejectedFlush;
  }
  const result = await successfulWrite;
  assert.equal(result.ok, true);
  assert.equal((await readJsonl(result.file)).length, 1);
});

test("concurrent runtime barriers observe failed receipts admitted during preparation", async (t) => {
  const sessionDir = await registeredSession(t);
  const entered = Promise.withResolvers();
  const release = Promise.withResolvers();
  const writing = writeRuntimeEvent(event, {
    locationResolver: {
      async locateSessionScope() {
        entered.resolve();
        await release.promise;
        return { sessionDir };
      },
    },
  });
  await entered.promise;
  const barriers = [flushRuntimeEvents(), flushRuntimeEvents()];
  let failedResult;
  let settled = 0;
  const checks = barriers.map((barrier) =>
    assert.rejects(barrier, (error) => {
      settled++;
      assert.ok(error instanceof AggregateError);
      assert.deepEqual(error.errors, [failedResult.error]);
      return true;
    }),
  );
  try {
    failedResult = await writeRuntimeEvent(event, {
      locationResolver: {
        async locateSessionScope() {
          return null;
        },
      },
    });
    assert.equal(failedResult.ok, false);
    assert.equal(failedResult.error.code, RUNTIME_EVENT_ERROR_CODE.SESSION_NOT_REGISTERED);
    await setImmediate();
    assert.equal(settled, 0);
  } finally {
    release.resolve();
    await Promise.all(checks);
  }
  assert.equal((await writing).ok, true);
  await flushRuntimeEvents();
});
