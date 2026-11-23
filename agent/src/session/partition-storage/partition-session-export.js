/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { TURN_EVENT } from "@noobot/session-protocol";
import { normalizeSessionEntity } from "../entities/session-entity.js";
import { readPartitionSessionSource } from "./partition-session-source.js";
import { PartitionTransactions } from "./partition-transactions.js";

export async function exportPartitionSession(options) {
  const { journal, snapshot, messages, ranges, state } = options;
  const source = await readPartitionSessionSource({
    ...options,
    readMessagePage: (page) => ranges.readPage(snapshot, page),
  });
  const keys = await new PartitionTransactions(journal).readKeysByCollection(snapshot, [
    "commands",
    "dialogs",
    "checkpointHeads",
  ]);
  const commandReceipts = [];
  for (const key of keys.get("commands")) {
    const receipt = await state.readCommand(snapshot, key);
    if (receipt !== null && Object.values(TURN_EVENT).includes(receipt.type))
      commandReceipts.push(receipt);
  }
  commandReceipts.sort((left, right) => left.sequence - right.sequence);
  const dialogOrder = [];
  for (const key of keys.get("dialogs")) {
    const dialog = await state.readDialog(snapshot, key);
    if (dialog !== null) dialogOrder.push(dialog);
  }
  const checkpoints = [];
  for (const turnScopeId of keys.get("checkpointHeads")) {
    const checkpoint = await messages.readCheckpointState({ snapshot, turnScopeId });
    if (checkpoint !== null) checkpoints.push([turnScopeId, checkpoint]);
  }
  return normalizeSessionEntity({
    ...source,
    dialogOrder,
    turnLifecycle: { ...source.turnLifecycle, commandReceipts },
    ...(checkpoints.length ? { turnSummaryCheckpoints: Object.fromEntries(checkpoints) } : {}),
  });
}
