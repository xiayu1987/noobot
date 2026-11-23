/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { readMigrationOutboxPages } from "../../src/workspace-lifecycle/immutable-session-migration-outbox.js";

function record(ordinal, fields) {
  return {
    committed: { ordinal, eventId: `e${ordinal}` },
    delivery: null,
    retired: false,
    ...fields,
  };
}

test("migration outbox consumes complete windows through the pinned tail", async () => {
  const requests = [];
  const source = {
    readMigrationOutboxPage(selection) {
      requests.push(selection);
      return selection.after === 0
        ? { records: [record(1), record(2)], cursor: 2 }
        : { records: [record(3, { retired: true })], cursor: 3 };
    },
  };
  const ordinals = [];
  for await (const page of readMigrationOutboxPages(source, { limit: 2, tail: 3 })) {
    ordinals.push(...page.records.map(({ committed }) => committed.ordinal));
  }
  assert.deepEqual(ordinals, [1, 2, 3]);
  assert.deepEqual(requests, [
    { after: 0, limit: 2 },
    { after: 2, limit: 2 },
  ]);
});

for (const [label, page] of [
  ["stalled", { records: [record(1), record(2)], cursor: 0 }],
  ["skipped", { records: [record(1), record(2)], cursor: 3 }],
  ["short", { records: [record(1)], cursor: 2 }],
  ["oversized", { records: [record(1), record(2), record(3)], cursor: 2 }],
  ["duplicate ordinal", { records: [record(1), record(1)], cursor: 2 }],
  [
    "retired with delivery",
    {
      records: [record(1), record(2, { delivery: { ordinal: 2, eventId: "e2" }, retired: true })],
      cursor: 2,
    },
  ],
  [
    "unrelated delivery",
    {
      records: [record(1), record(2, { delivery: { ordinal: 2, eventId: "other" } })],
      cursor: 2,
    },
  ],
]) {
  test(`migration outbox rejects ${label} page before yielding any records`, async () => {
    const source = { readMigrationOutboxPage: () => page };
    const iterator = readMigrationOutboxPages(source, { limit: 2, tail: 3 });
    await assert.rejects(iterator.next(), /invalid migration outbox page/);
  });
}
