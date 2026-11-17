/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { filePath as path } from "@noobot/path-resolver";
import { IMMUTABLE_SESSION_HEAD_FILE } from "@noobot/session-protocol/immutable-storage";
import { WORKSPACE_LAYOUT } from "@noobot/workspace-protocol";
import { SESSION_ARTIFACT_SCHEMA_VERSION } from "@noobot/session-protocol";
import { migrateLegacyPhaseSummaryMessages } from "@noobot/session-repair";
import { normalizeMessageEntity } from "../session/entities/message-entity.js";
import { ImmutableSessionStore } from "../session/session-artifact-session/immutable-session-store.js";
import { ImmutableSessionChanges } from "../session/session-artifact-session/immutable-message-changes.js";
import { updateImmutableToolPairs } from "../session/session-artifact-session/immutable-tool-pairs.js";
import { upgradeSessionMessageIdentity } from "./session-message-identity-upgrade.js";
import { upgradeModelContextSnapshots } from "./model-context-snapshot-upgrade.js";
import { walkSessionManifestDirectories, ignoreSessionProgress } from "./session-directory-walk.js";

export async function migrateImmutablePhaseSummaries({ sessionDir }) {
  const store = await ImmutableSessionStore.open({ sessionDir });
  const snapshot = await store.snapshot();
  return store.transact({
    expectedGeneration: snapshot.generation,
    operationId: `phase-summary-upgrade:${snapshot.generation}`,
    input: {},
    prepare: async ({ snapshot: pinned, get }) => {
      const metadata = await get("metadata", "session");
      if (metadata.schemaVersion >= SESSION_ARTIFACT_SCHEMA_VERSION)
        return { abort: true, changes: [], result: { upgraded: false } };
      const records = [];
      for await (const [, record] of store.entries(pinned, "messages")) records.push(record);
      const migration = migrateLegacyPhaseSummaryMessages(records.map((record) => record.message));
      const plan = new ImmutableSessionChanges(get);
      for (let index = 0; index < records.length; index += 1) {
        const previous = records[index];
        if (migration.messages[index] === previous.message) continue;
        const message = normalizeMessageEntity(migration.messages[index]);
        const record = { ...previous, message };
        const turn = await plan.get("turns", message.turnScopeId);
        const messagesRoot = await store.index.set(
          turn.messagesRoot,
          message.messageUid,
          await store.objects.putValue(record),
        );
        await updateImmutableToolPairs(store, plan, previous.message, message);
        plan.set("messages", message.messageUid, record);
        plan.set("turns", message.turnScopeId, { ...turn, messagesRoot });
      }
      plan.set("metadata", "session", {
        ...metadata,
        schemaVersion: SESSION_ARTIFACT_SCHEMA_VERSION,
      });
      return { changes: plan.changes(), result: { upgraded: true } };
    },
  });
}

export async function upgradeSessionPhaseSummaries(options) {
  const {
    base,
    scopedSessionRoots,
    storageService,
    onSessionProcessed = ignoreSessionProgress,
  } = options;

  const legacy = await upgradeSessionMessageIdentity(options);
  const immutable = [];
  for (const root of new Set([WORKSPACE_LAYOUT.SESSION_DIR, ...scopedSessionRoots])) {
    for await (const sessionDir of walkSessionManifestDirectories(path.join(base, root), {
      includeImmutable: true,
    })) {
      if (!(await storageService.exists(path.join(sessionDir, IMMUTABLE_SESSION_HEAD_FILE))))
        continue;
      const result = await migrateImmutablePhaseSummaries({ sessionDir });
      immutable.push({ sessionDir: path.relative(base, sessionDir), ...result });
      onSessionProcessed();
    }
  }
  const snapshots = await upgradeModelContextSnapshots({ ...options, restoreSummaryBodies: true });
  return { legacy, immutable, snapshots };
}
