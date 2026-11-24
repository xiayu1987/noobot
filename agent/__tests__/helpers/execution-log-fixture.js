/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { buildSessionArtifactFileMap } from "../../src/session/session-artifact-files.js";

export const TEST_TURN = "turn-1";

export function turnDirOf(root, dialogProcessId) {
  return path.join(buildSessionArtifactFileMap(root).executionEventsDir, "turns", dialogProcessId);
}

export async function readTurnIndex(root, dialogProcessId) {
  return JSON.parse(
    await readFile(path.join(turnDirOf(root, dialogProcessId), "index.json"), "utf8"),
  );
}
