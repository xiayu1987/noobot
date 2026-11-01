/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { mkdir, readFile, writeFile, readdir } from "node:fs/promises";
import {
  createEventEnvelope,
  EVENT_FAMILY,
  validateProtocolEvent,
  reduceAttachmentLifecycle,
} from "@noobot/event-protocol";
import { WORKSPACE_LAYOUT_UPGRADES, planWorkspaceLayoutUpgrades } from "@noobot/workspace-protocol";
import { attachmentLifecycleSequenceScopeId } from "@noobot/attachment-protocol";
import { buildHarness } from "./session/scoped-session-repositories.fixtures.js";
import { v9Options, jsonl } from "./helpers/session-identity-upgrade.fixtures.js";
import { upgradeSessionMessageIdentity } from "../src/workspace-lifecycle/session-message-identity-upgrade.js";
import { readAuthorityOutbox } from "../src/session/authority-outbox-store/outbox-journal.js";

function commit(sessionId, eventId, legacyId) {
  const identity = { attachmentId: "a1", sessionId, attachmentSource: "user" };
  const occurredAt = "2026-11-01T00:00:00.000Z";
  return {
    op: "commit",
    eventId,
    committedAt: occurredAt,
    envelope: createEventEnvelope({
      family: EVENT_FAMILY.ATTACHMENT_LIFECYCLE,
      schemaVersion: 1,
      identity: { eventId, eventType: "attachment_lifecycle", sessionId },
      causality: {},
      ordering: {
        domain: "attachment-lifecycle",
        scopeId: attachmentLifecycleSequenceScopeId(identity),
        sequence: eventId === "e1" ? 1 : 2,
      },
      producer: { type: "tool", id: "multimodal_parse" },
      occurredAt,
      payload: {
        eventVersion: 1,
        eventType: "attachment.received",
        status: "received",
        identity,
        occurredAt,
        attachmentEventId: legacyId,
      },
    }),
  };
}
async function fileBytes(directory) {
  const entries = await readdir(directory, { recursive: true, withFileTypes: true });
  return Object.fromEntries(
    await Promise.all(
      entries
        .filter((entry) => entry.isFile())
        .map(async (entry) => {
          const file = path.join(entry.parentPath, entry.name);
          return [path.relative(directory, file), (await readFile(file)).toString("base64")];
        }),
    ),
  );
}

test("v30 upgrades attachment journal identity, preserves delivery and isolates ambiguous sessions atomically", async (t) => {
  const harness = buildHarness();
  const { root, sessionRepo } = await harness.setup();
  t.after(() => harness.cleanup());
  const directories = {};
  for (const sessionId of ["a-broken", "z-valid"]) {
    const persistenceContext = sessionRepo.treePersistenceContext("alice", sessionId);
    await sessionRepo.ensureSession({
      userId: "alice",
      sessionId,
      parentSessionId: "",
      caller: "user",
      persistenceContext,
    });
    const scope = await sessionRepo.requireSessionScope("alice", sessionId, persistenceContext);
    directories[sessionId] = scope.sessionDir;
    const dir = path.join(scope.sessionDir, "authority-outbox");
    await mkdir(dir, { recursive: true });
    const first = commit(sessionId, "e1", "old-1");
    const records = [
      first,
      { op: "attempt", eventId: "e1", consumerId: "c1", attemptedAt: first.committedAt },
    ];
    if (sessionId === "a-broken") records.push(commit(sessionId, "e2", "old-1"));
    await writeFile(path.join(dir, "outbox.jsonl"), jsonl(records));
  }
  assert.deepEqual(planWorkspaceLayoutUpgrades({ installedVersion: 29 }), [
    WORKSPACE_LAYOUT_UPGRADES.at(-1),
  ]);
  const brokenBefore = await fileBytes(directories["a-broken"]);
  const validBefore = await fileBytes(directories["z-valid"]);
  const upgraded = await upgradeSessionMessageIdentity(v9Options(root));
  assert.equal(upgraded.quarantined.length, 1);
  assert.match(
    JSON.stringify(upgraded.quarantined[0]),
    /attachment_lifecycle_migration_ambiguous_identity/,
  );
  assert.equal(upgraded.sessions.length, 1);
  assert.deepEqual(await fileBytes(directories["a-broken"]), brokenBefore);
  const outbox = await readAuthorityOutbox(directories["z-valid"]);
  assert.equal(outbox.length, 1);
  assert.equal(outbox[0].eventId, "e1");
  assert.equal(outbox[0].deliveries.c1.attempts, 1);
  assert.equal(validateProtocolEvent(outbox[0].envelope).valid, true);
  const state = reduceAttachmentLifecycle(undefined, outbox[0].envelope);
  assert.equal(
    reduceAttachmentLifecycle(state, JSON.parse(JSON.stringify(outbox[0].envelope))),
    state,
  );
  const journal = "authority-outbox/outbox.jsonl";
  const validAfter = await fileBytes(directories["z-valid"]);
  for (const file of Object.keys(validBefore).filter((file) => file !== journal)) {
    assert.equal(validAfter[file], validBefore[file], file);
  }
  const backup = path.join(
    v9Options(root).backupBase,
    path.relative(v9Options(root).base, directories["z-valid"]),
    journal,
  );
  assert.equal((await readFile(backup)).toString("base64"), validBefore[journal]);
  const repeated = await upgradeSessionMessageIdentity(v9Options(root));
  assert.equal(repeated.sessions.length, 0);
  assert.equal(repeated.quarantined.length, 1);
  assert.deepEqual(await fileBytes(directories["z-valid"]), validAfter);
  assert.deepEqual(await fileBytes(directories["a-broken"]), brokenBefore);
});
