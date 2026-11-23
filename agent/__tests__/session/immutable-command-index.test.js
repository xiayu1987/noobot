/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, rename } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { SESSION_COMMAND, createEmptyTurnLifecycle } from "@noobot/session-protocol";
import { SESSION_CALLER } from "@noobot/shared/session-caller";
import { initializeImmutableSession } from "../../src/session/session-artifact-session/immutable-session-bootstrap.js";
import { ImmutableSessionStore } from "../../src/session/session-artifact-session/immutable-session-store.js";
import { ImmutableSessionChanges } from "../../src/session/session-artifact-session/immutable-message-changes.js";
import {
  immutableLifecycleCommandKey,
  immutableAttachmentBindingKey,
  writeImmutableCommand,
  retireImmutableSuffixCommands,
} from "../../src/session/session-artifact-session/immutable-command-index.js";
import { upgradeImmutableCommandIndexes } from "../../src/session/session-artifact-session/immutable-command-index-upgrade.js";
import { setFsAdapter, resetFsAdapter } from "../../src/shared/storage/fs-adapter.js";
import { collectValueRecords, forbidRecordReads } from "./helpers/immutable-record-reads.js";

const ts = "2026-01-01T00:00:00.000Z";
const receipt = (id, scope, type = SESSION_COMMAND.TURN_COMMIT) => ({
  commandId: id,
  type,
  requestHash: `hash:${id}`,
  aggregateVersion: 1,
  committedAt: ts,
  ...(scope ? { turnScopeId: scope } : {}),
  result: { messageUid: `m:${id}` },
});
async function fixture(t) {
  const sessionDir = await mkdtemp(path.join(tmpdir(), "command-index-"));
  t.after(() => rm(sessionDir, { recursive: true, force: true }));
  await initializeImmutableSession({
    sessionDir,
    operationId: "initialize",
    session: {
      sessionId: "s1",
      parentSessionId: "",
      caller: SESSION_CALLER.USER,
      aggregateVersion: 0,
      messages: [],
      dialogOrder: [],
      turnTimings: [],
      sessionArtifactEvents: [],
      turnLifecycle: createEmptyTurnLifecycle(),
      createdAt: ts,
      updatedAt: ts,
    },
  });
  return new ImmutableSessionStore({ sessionDir, sessionId: "s1" });
}
async function mutate(store, operationId, apply, generation) {
  return store.transact({
    expectedGeneration: generation ?? (await store.snapshot()).generation,
    operationId,
    input: {},
    prepare: async ({ get }) => {
      const plan = new ImmutableSessionChanges(get);
      const result = await apply(plan);
      return { changes: plan.changes(), result };
    },
  });
}

test("suffix retirement removes deleted bindings but preserves surviving bindings, global receipts and pinned readers", async (t) => {
  const store = await fixture(t);
  await mutate(store, "seed", async (plan) => {
    for (const item of [
      receipt("a", "t1"),
      receipt("b", "t1", SESSION_COMMAND.TURN_ATTACHMENTS_BIND),
      receipt("kept", "t1", SESSION_COMMAND.TURN_ATTACHMENTS_BIND),
      receipt("c", "t2"),
      receipt("global", ""),
    ])
      await writeImmutableCommand(store, plan, item);
  });
  const before = await store.snapshot();
  const remove = (owner) => async (plan) => {
    await retireImmutableSuffixCommands(owner, plan, { turnScopeIds: ["t1"], uids: ["m:b"] });
    plan.set("metadata", "removal", { complete: true });
  };
  const result = await mutate(store, "remove", remove(store), before.generation);
  const after = await store.snapshot();
  assert.equal(after.generation, before.generation + 1);
  assert.equal(await store.get(after, "commands", immutableLifecycleCommandKey("a")), null);
  assert.equal(await store.get(after, "commands", immutableLifecycleCommandKey("b")), null);
  assert.equal(await store.get(after, "commands", immutableAttachmentBindingKey("m:b")), null);
  assert.equal((await store.get(after, "turnCommands", "t1")).count, 1);
  assert.equal(await store.get(after, "commands", immutableAttachmentBindingKey("m:kept")), "kept");
  assert.equal((await store.get(after, "turnCommands", "t2")).count, 1);
  assert.deepEqual(
    await store.get(after, "commands", immutableLifecycleCommandKey("global")),
    receipt("global", ""),
  );
  assert.deepEqual(
    await store.get(before, "commands", immutableLifecycleCommandKey("a")),
    receipt("a", "t1"),
  );
  const reopened = new ImmutableSessionStore({ sessionDir: store.sessionDir, sessionId: "s1" });
  assert.deepEqual(await mutate(reopened, "remove", remove(reopened), before.generation), {
    ...result,
    replayed: true,
  });
  assert.deepEqual(await reopened.snapshot(), after);
});

test("cold command removal does not read unrelated receipt bodies", async (t) => {
  const store = await fixture(t);
  await mutate(store, "seed", async (plan) => {
    await writeImmutableCommand(store, plan, receipt("cold", "t1"));
    await writeImmutableCommand(store, plan, receipt("selected", "t2"));
  });
  const snapshot = await store.snapshot();
  const records = await store.objects.withSnapshot(snapshot, async () => {
    const root = await store.index.get(snapshot.root, "commands");
    const reference = await store.index.get(root, immutableLifecycleCommandKey("cold"));
    return collectValueRecords(store, reference);
  });
  setFsAdapter(await forbidRecordReads(store, records));
  t.after(resetFsAdapter);
  const reopened = new ImmutableSessionStore({ sessionDir: store.sessionDir, sessionId: "s1" });
  await mutate(reopened, "remove", (plan) =>
    retireImmutableSuffixCommands(reopened, plan, { turnScopeIds: ["t2"], uids: ["m:selected"] }),
  );
  assert.equal(await reopened.get(await reopened.snapshot(), "turnCommands", "t2"), null);
});

test("publication failure leaves command receipts and binding aliases intact", async (t) => {
  const store = await fixture(t);
  await mutate(store, "seed", (plan) =>
    writeImmutableCommand(
      store,
      plan,
      receipt("bind", "t1", SESSION_COMMAND.TURN_ATTACHMENTS_BIND),
    ),
  );
  const before = await store.snapshot();
  const remove = (plan) =>
    retireImmutableSuffixCommands(store, plan, { turnScopeIds: ["t1"], uids: ["m:bind"] });
  setFsAdapter({
    rename: async (source, target) => {
      if (target === store.headPath)
        throw Object.assign(new Error("injected failure"), { code: "EIO" });
      return rename(source, target);
    },
  });
  try {
    await assert.rejects(mutate(store, "remove", remove), { code: "SESSION_COMMIT_UNCERTAIN" });
  } finally {
    resetFsAdapter();
  }
  assert.deepEqual(await store.snapshot(), before);
  assert.equal(
    await store.get(before, "commands", immutableAttachmentBindingKey("m:bind")),
    "bind",
  );
  await mutate(store, "remove", remove);
  assert.equal(await store.get(await store.snapshot(), "turnCommands", "t1"), null);
});

test("missing index requires explicit upgrade; rebuilding preserves receipts and is idempotent", async (t) => {
  const store = await fixture(t);
  await mutate(store, "seed", (plan) =>
    writeImmutableCommand(
      store,
      plan,
      receipt("bind", "t1", SESSION_COMMAND.TURN_ATTACHMENTS_BIND),
    ),
  );
  await mutate(store, "legacy", (plan) => {
    plan.remove("metadata", "commandIndex");
    plan.remove("turnCommands", "t1");
  });
  await assert.rejects(
    mutate(store, "write", (plan) => writeImmutableCommand(store, plan, receipt("next", "t1"))),
    { code: "SESSION_IMMUTABLE_INDEX_UPGRADE_REQUIRED" },
  );
  const options = { sessionDir: store.sessionDir, sessionId: "s1" };
  assert.equal((await upgradeImmutableCommandIndexes(options)).result.upgraded, true);
  const after = await store.snapshot();
  assert.equal((await store.get(after, "turnCommands", "t1")).count, 1);
  assert.equal((await upgradeImmutableCommandIndexes(options)).result.upgraded, false);
  assert.deepEqual(await store.snapshot(), after);
  await mutate(store, "remove", (plan) =>
    retireImmutableSuffixCommands(store, plan, { turnScopeIds: ["t1"], uids: ["m:bind"] }),
  );
  assert.equal(await store.get(await store.snapshot(), "turnCommands", "t1"), null);
});

test("corrupt membership or attachment alias aborts removal without publishing partial changes", async (t) => {
  for (const corruption of ["count", "binding"]) {
    const store = await fixture(t);
    await mutate(store, "seed", (plan) =>
      writeImmutableCommand(
        store,
        plan,
        receipt("bind", "t1", SESSION_COMMAND.TURN_ATTACHMENTS_BIND),
      ),
    );
    await mutate(store, "corrupt", async (plan) => {
      if (corruption === "count")
        plan.set("turnCommands", "t1", { ...(await plan.get("turnCommands", "t1")), count: 2 });
      else plan.set("commands", immutableAttachmentBindingKey("m:bind"), "wrong");
    });
    const before = await store.snapshot();
    await assert.rejects(
      mutate(store, "remove", (plan) =>
        retireImmutableSuffixCommands(store, plan, { turnScopeIds: ["t1"], uids: ["m:bind"] }),
      ),
      { code: "SESSION_IMMUTABLE_STORAGE_INVALID" },
    );
    assert.deepEqual(await store.snapshot(), before);
  }
});

test("offline upgrade rejects orphan binding aliases and unknown index versions", async (t) => {
  for (const corruption of ["orphan", "version"]) {
    const store = await fixture(t);
    await mutate(store, "corrupt", (plan) => {
      if (corruption === "version") plan.set("metadata", "commandIndex", { version: 2 });
      else {
        plan.remove("metadata", "commandIndex");
        plan.set("commands", immutableAttachmentBindingKey("missing"), "missing");
      }
    });
    const before = await store.snapshot();
    await assert.rejects(
      upgradeImmutableCommandIndexes({ sessionDir: store.sessionDir, sessionId: "s1" }),
      { code: "SESSION_IMMUTABLE_STORAGE_INVALID" },
    );
    assert.deepEqual(await store.snapshot(), before);
  }
});
