/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { filePath as path } from "@noobot/path-resolver";
import { isCanonicalText, isFunction } from "@noobot/shared/value";
import { sessionMutationCoordinator } from "../session/session-mutation-coordinator.js";
import { resolveSessionArtifactMutationLock } from "../session/session-artifact-files.js";
import { quarantineMigrationUnit } from "./migration-quarantine.js";
import { walkSessionManifestDirectories } from "./session-directory-walk.js";

export async function upgradeSessionDirectories({
  base,
  roots,
  kind,
  upgrade,
  quarantineCode,
  normalizeError,
  onSessionProcessed,
}) {
  if (!isCanonicalText(quarantineCode)) {
    throw new TypeError("session upgrade driver requires quarantineCode");
  }
  if (!isFunction(normalizeError)) {
    throw new TypeError("session upgrade driver requires normalizeError");
  }
  const sessions = [];
  const quarantined = [];
  for (const [rootIndex, root] of roots.entries()) {
    const sessionRoot = path.join(base, root);
    for await (const sessionDir of walkSessionManifestDirectories(sessionRoot)) {
      const relativePath = path.relative(base, sessionDir);
      try {
        const result = await sessionMutationCoordinator.run(
          resolveSessionArtifactMutationLock(sessionDir),
          () => upgrade({ sessionDir, rootIndex }),
        );
        if (result) sessions.push(result);
      } catch (error) {
        const failure = normalizeError(error, relativePath);
        if (failure?.code !== quarantineCode) throw failure;
        quarantined.push(
          await quarantineMigrationUnit({ base, kind, relativePath, error: failure }),
        );
      }
      onSessionProcessed();
    }
  }
  return { sessions, quarantined };
}
