/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import test from "node:test";
import { readdir } from "node:fs/promises";
import path from "node:path";
import { IMMUTABLE_READER_RETENTION as RETENTION } from "@noobot/session-protocol/immutable-storage";
import { ImmutableSessionStore } from "../../src/session/session-artifact-session/immutable-session-store.js";
import { auditImmutableSession } from "../../src/session/session-artifact-session/immutable-session-audit.js";
import { prepareAndCleanupSessionArtifacts } from "../helpers/immutable-cleanup.js";
import { TEST_STORAGE_SERVICE as storageService } from "../helpers/storage-service.js";
import {
  immutableMutationFixture,
  mutationMessage as message,
} from "../helpers/immutable-mutation-integration-fixture.js";

for (const kind of ["delete", "replace"]) {
  test(`${kind} command effects survive historical index retirement and replay`, async (t) => {
    const f = await immutableMutationFixture(t, { messages: [message("keep"), message("drop")] });
    const request = { ...f.request, commandId: kind, anchor: { turnScopeId: "drop" } };
    const mutate =
      kind === "delete"
        ? () => f.service.deleteFromMessage(request)
        : () =>
            f.service.replaceTurn({
              ...request,
              newContent: "replacement",
              turnScopeId: "replacement",
              attachments: [],
            });
    const result = await mutate();
    const store = new ImmutableSessionStore({ sessionDir: f.scope.sessionDir, sessionId: "s1" });
    const historical = await store.snapshot();
    const original = await f.open();
    const projection = await original.readMutationProjection(kind);
    const changes = await original.readCommandChanges(kind);
    await original.close();
    await f.commit({ messages: [message("later")] });
    await f.commit({ messages: [{ ...message("keep"), content: "edited later" }] });
    assert.deepEqual(await readdir(path.join(f.scope.sessionDir, RETENTION.directory)), []);
    const cleanup = await prepareAndCleanupSessionArtifacts({
      storageService,
      sessionDir: f.scope.sessionDir,
      assertSessionWritable: async () => {},
      dryRun: false,
    });
    assert.equal(cleanup.complete, true);
    const retainedObjects = new Set();
    const audit = await auditImmutableSession({
      sessionDir: f.scope.sessionDir,
      retainedObjects,
    });
    assert.equal(audit.ok, true, JSON.stringify(audit));

    assert.equal(retainedObjects.has(historical.root), false);
    await using current = await f.open();
    assert.deepEqual(await current.readCommandChanges(kind), changes);
    assert.deepEqual(await current.readMutationProjection(kind), projection);
    assert.equal((await current.readMessage("keep")).message.content, "edited later");
    assert.ok((await current.readMessage("later")).message);
    const replayed = await mutate();
    assert.equal(replayed.commandId, result.commandId);
    assert.equal(replayed.deduplicated, true);
    assert.deepEqual(await current.readMutationProjection(kind), projection);
  });
}
