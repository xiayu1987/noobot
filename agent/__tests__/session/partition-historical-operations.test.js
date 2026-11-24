/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { createPartitionHistoricalOperationMutation } from "@noobot/session-protocol/partition-transaction";
import { PartitionTransactions } from "../../src/session/partition-storage/partition-transactions.js";
import {
  commitFixtureTransaction,
  createTransactionCase,
} from "../helpers/partition-journal-cases.js";
import { createAt } from "./partition-transactions.test-helpers.js";

test("later requests in the same batch cannot execute a staged historical operation", async (t) => {
  const { journal } = await createTransactionCase(t, { batchWaitMs: 10 });
  const writer = new PartitionTransactions(journal);
  const evidence = {
    format: "noobot.immutable-migration-operation/1",
    operationId: "historical-operation",
    receipt: { generation: 90, commit: "a".repeat(64), digest: "b".repeat(64), result: null },
  };
  const imported = commitFixtureTransaction(writer, {
    ...createAt(journal, 1),
    operationId: evidence.operationId,
    mutations: [createPartitionHistoricalOperationMutation(evidence)],
  });
  const rejected = assert.rejects(
    writer.commit(
      {
        epoch: journal.head.epoch,
        expectedGeneration: 1,
        operationId: evidence.operationId,
        input: {},
      },
      {
        validateScope: () => {},
        prepare: () => assert.fail("Staged historical operation reached business preparation"),
      },
    ),
    { code: "SESSION_OPERATION_RETRY_UNAVAILABLE" },
  );
  await Promise.all([imported, rejected]);
  assert.equal(journal.head.sequence, 1);
});
