/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { mergeTurnTimingRecord, SESSION_ERROR_CODE } from "@noobot/session-protocol";
import { PartitionAdmissionRejection } from "@noobot/session-protocol/partition-journal";
import { readPartitionTurnMembershipVisibility } from "@noobot/session-protocol/partition-turn-visibility";
import { checkPartitionMessageStorage } from "./partition-message-record.js";
import { createPartitionIndexMutations } from "./partition-index-mutations.js";
import {
  requirePartitionMessageTurnOwnership,
  requirePartitionTurnTimingOwnership,
  requirePartitionTurnTimingRecord,
} from "@noobot/session-protocol/partition-session-messages";

function mergeTiming(timing, record, ownership) {
  const existing = record && !record.mutation.remove;
  if (existing)
    requirePartitionTurnTimingRecord(record.mutation.value, timing.turnScopeId, ownership);
  try {
    requirePartitionTurnTimingOwnership(timing, ownership);
    return existing ? mergeTurnTimingRecord(record.mutation.value, timing) : timing;
  } catch (cause) {
    if (cause.code !== SESSION_ERROR_CODE.TURN_TIMING_CONFLICT) throw cause;
    throw Object.assign(new PartitionAdmissionRejection(cause.code, cause.message), { cause });
  }
}

export async function preparePartitionTimings({ view, mutations, timings, snapshot, scope }) {
  if (!timings.length) return;
  const { readStaged: read, hasStaged } = createPartitionIndexMutations(view, mutations);
  const keys = timings.map(({ turnScopeId }) => turnScopeId);
  const ownership = await requirePartitionMessageTurnOwnership(
    read,
    keys.map((turnScopeId) => ({ turnScopeId })),
  );
  const previous = await read({ collection: "timings", keys, includeOwner: true });
  const visible = await readPartitionTurnMembershipVisibility(
    read,
    ownership.turns,
    (record, messageUid) =>
      checkPartitionMessageStorage(record, {
        snapshot,
        scope,
        messageUid,
        generation: view.generation + Number(hasStaged("messages", messageUid)),
      }),
  );
  for (const timing of timings) {
    const key = timing.turnScopeId;
    if (!visible.get(key))
      throw new PartitionAdmissionRejection(
        SESSION_ERROR_CODE.TURN_TIMING_CONFLICT,
        "Timing belongs to a hidden turn",
      );
    const record = previous.get(key);
    const value = mergeTiming(timing, record, ownership);
    mutations.push({ collection: "timings", key, value, owner: record?.owner ?? null });
  }
}

export async function readPartitionTurnTiming(read, turnScopeId, snapshot, scope) {
  const stored = (await read({ collection: "timings", keys: [turnScopeId] })).get(turnScopeId);
  if (!stored) return null;
  const ownership = await requirePartitionMessageTurnOwnership(read, [{ turnScopeId }]);
  const visible = await readPartitionTurnMembershipVisibility(
    read,
    ownership.turns,
    (record, messageUid) =>
      checkPartitionMessageStorage(record, {
        snapshot,
        scope,
        messageUid,
        generation: snapshot.sequence,
      }),
  );
  return visible.get(turnScopeId)
    ? requirePartitionTurnTimingRecord(stored.value, turnScopeId, ownership)
    : null;
}
