/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm, open, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { IMMUTABLE_CLEANUP_PLAN as PLAN } from "@noobot/session-protocol/immutable-storage";
import { ImmutableSessionStore } from "../../src/session/session-artifact-session/immutable-session-store.js";
import { buildImmutableCleanupPlan } from "../../src/session/session-artifact-session/immutable-cleanup-plan.js";
import { resetFsAdapter, setFsAdapter } from "../../src/shared/storage/fs-adapter.js";

for (const file of [PLAN.manifest, PLAN.preparation]) {
  for (const stage of ["read", "close"]) {
    test(`${file} ${stage} ENOENT propagates without treating an opened record as absent`, async (t) => {
      const sessionDir = await mkdtemp(path.join(tmpdir(), "cleanup-capture-reads-"));
      t.after(async () => {
        resetFsAdapter();
        await rm(sessionDir, { recursive: true, force: true });
      });
      const store = new ImmutableSessionStore({
        sessionDir,
        sessionId: "reads",
        allowCreate: true,
      });
      await store.commit({ expectedGeneration: 0, operationId: "seed", changes: [] });
      const options = { sessionDir, dryRun: false, publish: (run) => run() };
      let planId;
      if (file === PLAN.manifest) planId = (await buildImmutableCleanupPlan(options)).planId;
      else {
        const failure = new Error("pause before plan publication");
        await assert.rejects(
          buildImmutableCleanupPlan({
            ...options,
            publish: async () => {
              throw failure;
            },
          }),
          (error) => {
            planId = error.planId;
            return error.cause === failure;
          },
        );
      }
      const directory = path.join(sessionDir, PLAN.directory, planId);
      const target = path.join(directory, file);
      const before = await readFile(target);
      const failure = Object.assign(new Error(`injected ${stage} failure`), { code: "ENOENT" });
      let closes = 0;
      setFsAdapter({
        open: async (name, flags, ...args) => {
          const handle = await open(name, flags, ...args);
          if (name === target && flags === "r") {
            if (stage === "read")
              handle.read = async () => {
                throw failure;
              };
            const close = handle.close.bind(handle);
            handle.close = async () => {
              closes += 1;
              await close();
              if (stage === "close") throw failure;
            };
          }
          return handle;
        },
      });
      await assert.rejects(
        buildImmutableCleanupPlan({ ...options, planId }),
        (error) => error === failure,
      );
      assert.equal(closes, 1);
      resetFsAdapter();
      assert.deepEqual(await readFile(target), before);
      assert.equal((await buildImmutableCleanupPlan({ ...options, planId })).complete, true);
    });
  }
}
