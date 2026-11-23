/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { execFile } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { bindImmutableMigrationSource } from "@noobot/session-protocol/immutable-storage";
import {
  IMMUTABLE_SEGMENT,
  immutableSegmentFileName,
} from "@noobot/session-protocol/immutable-segment";
import { migratedWorkspace } from "./workspace-session-immutable-storage-upgrade.test-helpers.js";

export const execFileAsync = promisify(execFile);

export function runColdMigrationProcess(script, argument) {
  const runtime = new URL("../../shared/testing/runtime-params.js", import.meta.url);
  return execFileAsync(
    process.execPath,
    ["--import", runtime.href, "--input-type=module", "-e", script, JSON.stringify(argument)],
    { timeout: 15000 },
  );
}

export async function createIsolatedMigrationFixture(t) {
  const { base, sessionDir, store } = await migratedWorkspace(t);
  const scratchRoot = join(base, "scratch");
  await mkdir(scratchRoot);
  const head = await store.snapshot();
  const expectedSource = bindImmutableMigrationSource(head, null);
  const tail = immutableSegmentFileName(head.segmentTail.segmentId);
  return {
    options: { sessionDir, scratchRoot, expectedSource },
    store,
    head,
    tail,
    sourceTail: join(sessionDir, IMMUTABLE_SEGMENT.directory, tail),
  };
}
