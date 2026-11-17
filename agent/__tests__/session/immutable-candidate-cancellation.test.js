/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import test from "node:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { immutableOwnedInventory } from "../../src/session/session-artifact-session/immutable-object-garbage.js";
import { IMMUTABLE_LOCATED_SESSION_FORMAT } from "@noobot/session-protocol/immutable-storage";
import { IMMUTABLE_SEGMENT } from "@noobot/session-protocol/immutable-segment";

for (const scope of ["segments", "root"]) {
  test(`candidate ${scope} scan preserves the original cancellation reason across its yield`, async (t) => {
    const sessionDir = await mkdtemp(path.join(tmpdir(), "immutable-candidate-cancel-"));
    t.after(() => rm(sessionDir, { recursive: true, force: true }));
    const segments = path.join(sessionDir, IMMUTABLE_SEGMENT.directory);
    await mkdir(segments);
    const directory = scope === "segments" ? segments : sessionDir;
    for (let i = 0; i < 128; i += 1) await writeFile(path.join(directory, `foreign-${i}`), "keep");
    const controller = new AbortController();
    const reason = new Error(`cancel while yielding in ${scope}`);
    let checks = 0;
    t.mock.method(controller.signal, "throwIfAborted", () => {
      AbortSignal.prototype.throwIfAborted.call(controller.signal);
      if (++checks === 64) queueMicrotask(() => controller.abort(reason));
    });
    const candidates = [];
    await assert.rejects(
      async () => {
        for await (const file of immutableOwnedInventory({
          sessionDir,
          format: IMMUTABLE_LOCATED_SESSION_FORMAT,
          signal: controller.signal,
        }))
          candidates.push(file);
      },
      (error) => error === reason,
    );
    assert.equal(controller.signal.aborted, true);
    assert.deepEqual(candidates, []);
  });
}

test("candidate inventory requires a session migrated to the located format", async (t) => {
  const sessionDir = await mkdtemp(path.join(tmpdir(), "immutable-candidate-format-"));
  t.after(() => rm(sessionDir, { recursive: true, force: true }));
  await assert.rejects(
    Array.fromAsync(immutableOwnedInventory({ sessionDir, format: "noobot.immutable-session/3" })),
    { code: "SESSION_MAINTENANCE_MIGRATION_REQUIRED" },
  );
});
