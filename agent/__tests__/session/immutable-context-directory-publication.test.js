/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import test from "node:test";
import { ORDINAL_DIRECTORY_FANOUT } from "@noobot/session-protocol/ordinal-directory";
import {
  assistantMessage,
  commit,
  corrupt,
  fixture,
  read,
} from "./immutable-context-tail-read.test-helpers.js";

test("context split refuses orphan evidence without publishing any part of a business append", async (t) => {
  const store = await fixture(t);
  const candidate = (id) =>
    assistantMessage(id, {
      dialogProcessId: "d-keep",
      turnScopeId: "t-keep",
      presentationMessageId: "p-keep",
    });
  await commit(store, "fill-directory-leaf", {
    messages: Array.from({ length: ORDINAL_DIRECTORY_FANOUT - 1 }, (_, index) =>
      candidate(`candidate-${index}`),
    ),
  });
  const healthy = await store.snapshot();
  const before = await read(store, healthy, { historyLimit: 2 });
  const descriptor = await store.get(healthy, "contextSources", "t-keep");
  assert.equal(descriptor.count, ORDINAL_DIRECTORY_FANOUT);
  assert.equal(descriptor.directory.ordinals.length, ORDINAL_DIRECTORY_FANOUT);
  const orphanKey = JSON.stringify(["t-keep", "00"]);
  const orphan = { ordinals: [1] };
  const broken = await corrupt(store, [
    { collection: "contextCandidateRanges", key: orphanKey, value: orphan },
  ]);
  await assert.rejects(commit(store, "split-over-orphan", { messages: [candidate("rejected")] }), {
    code: "SESSION_IMMUTABLE_STORAGE_INVALID",
  });
  const after = await store.snapshot();
  assert.deepEqual(after, broken);
  assert.deepEqual(await store.get(after, "contextSources", "t-keep"), descriptor);
  assert.deepEqual(await store.get(after, "contextCandidateRanges", orphanKey), orphan);
  assert.equal(await store.get(after, "messages", "m-rejected"), null);
  assert.deepEqual(await read(store, healthy, { historyLimit: 2 }), before);
});
