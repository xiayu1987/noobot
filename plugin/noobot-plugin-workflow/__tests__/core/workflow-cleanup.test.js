/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { cleanupWorkflowBySessionIds } from "../../src/utils/cleanup.js";

test("workflow cleanup validates all paths before deletion and propagates filesystem failures", async () => {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), "workflow-cleanup-"));
  try {
    const root = path.join(base, "runtime/plugin-data/workflow/session");
    await fs.mkdir(path.join(root, "keep"), { recursive: true });
    await assert.rejects(cleanupWorkflowBySessionIds(base, ["keep", "../escape"]), TypeError);
    for (const sessionId of [42, null, {}, [], " keep ", "bad..segment", "bad:segment"]) {
      await assert.rejects(cleanupWorkflowBySessionIds(base, ["keep", sessionId]), TypeError);
    }
    assert.equal((await fs.stat(path.join(root, "keep"))).isDirectory(), true);
    await cleanupWorkflowBySessionIds(base, ["absent"]);
    await fs.writeFile(path.join(root, "blocked"), "file");
    await assert.rejects(cleanupWorkflowBySessionIds(base, ["blocked/child"]), TypeError);
    await fs.rm(root, { recursive: true });
    await fs.writeFile(root, "file");
    await assert.rejects(cleanupWorkflowBySessionIds(base, ["child"]), { code: "ENOTDIR" });
  } finally {
    await fs.rm(base, { recursive: true, force: true });
  }
});
