/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { access, mkdir, rename } from "node:fs/promises";
import { filePath as path } from "@noobot/path-resolver";
import { WORKSPACE_LAYOUT } from "@noobot/workspace-protocol";
import { sessionMutationCoordinator } from "../session/session-mutation-coordinator.js";
import { resolveSessionArtifactMutationLock } from "../session/session-artifact-files.js";
import { ignoreSessionProgress, walkSessionManifestDirectories } from "./session-directory-walk.js";

const RETIRED_TASK_ARTIFACT_FILE = "task.json";

async function retireTaskArtifact({ base, backupBase, sessionDir }) {
  const sourcePath = path.join(sessionDir, RETIRED_TASK_ARTIFACT_FILE);
  try {
    await access(sourcePath);
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
  const relativePath = path.relative(base, sourcePath);
  const backupPath = path.join(backupBase, relativePath);
  await mkdir(path.dirname(backupPath), { recursive: true });

  await rename(sourcePath, backupPath);
  return { path: relativePath, backupPath };
}

export async function retireSessionTaskArtifacts({
  base,
  backupBase,
  scopedSessionRoots,
  onSessionProcessed = ignoreSessionProgress,
}) {
  if (!Array.isArray(scopedSessionRoots) || !scopedSessionRoots.length) {
    throw new TypeError("session task artifact retirement requires scopedSessionRoots");
  }
  const retired = [];
  for (const root of [WORKSPACE_LAYOUT.SESSION_DIR, ...scopedSessionRoots]) {
    for await (const sessionDir of walkSessionManifestDirectories(path.join(base, root))) {
      const result = await sessionMutationCoordinator.run(
        resolveSessionArtifactMutationLock(sessionDir),
        () => retireTaskArtifact({ base, backupBase, sessionDir }),
      );
      if (result) retired.push(result);
      onSessionProcessed();
    }
  }
  return { retired };
}
