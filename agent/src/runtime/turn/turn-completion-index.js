/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  isInjectedMessage,
  resolveInjectedMessageType,
} from "@noobot/context-protocol/policy/message";
import { isContextControlMessage } from "@noobot/context-protocol/policy/injected-message";
import {
  shouldMarkCurrentTurnSummarizedMessageInScope,
  resolveSummaryInjectedRetentionKey,
} from "@noobot/context-protocol/policy/summary";
import { projectSessionRecordToContextMessage } from "@noobot/context-protocol/message/session-projection";
import {
  resolveContextToolCallName,
  resolveContextMessageRole,
  resolveContextToolCalls,
  resolveContextToolCallDeclarationId,
  resolveContextToolResultCallId,
} from "@noobot/context-protocol/message/codec";
import { SUMMARY_ALWAYS_RETAINED_INJECTED_MESSAGE_TYPES } from "@noobot/context-protocol/message/injected-types";
import {
  FLOW_CONTROL_ROLE,
  hasToolCallFlowControlRole,
} from "@noobot/context-protocol/tool/context-policy";
import { createMessagePositionIndex } from "./message-position-index.js";

const alwaysRetained = new Set(SUMMARY_ALWAYS_RETAINED_INJECTED_MESSAGE_TYPES);
const evidenceRole = FLOW_CONTROL_ROLE.CHECKPOINT_EVIDENCE;
const evidenceGroupPrefix = `["${evidenceRole}",`;
const emptyScope = {
  retainedInjectedIndexes: new Set(),
  latestCheckpointEvidenceIndexes: new Set(),
};

function describe(record) {
  const message = projectSessionRecordToContextMessage({
    messageUid: record.messageUid,
    role: record.role,
    tool_calls: record.tool_calls,
    tool_call_id: record.tool_call_id,
    contextPolicy: record.contextPolicy,
    injectedMessage: record.injectedMessage,
    injectedMessageType: record.injectedMessageType,
    injectedBy: record.injectedBy,
    noobotInternalMessageType: record.noobotInternalMessageType,
  });
  const injected = isInjectedMessage(message);
  const control = isContextControlMessage(message);
  const type = resolveInjectedMessageType(message);
  const calls =
    resolveContextMessageRole(message) === "assistant" ? resolveContextToolCalls(message) : [];
  const groups = new Set();
  const retentionKey = resolveSummaryInjectedRetentionKey(message);
  if (retentionKey !== null) groups.add(retentionKey);
  for (const call of calls) {
    const name = resolveContextToolCallName(call);
    if (!name) continue;
    if (hasToolCallFlowControlRole(call, evidenceRole))
      groups.add(JSON.stringify([evidenceRole, name]));
  }
  return {
    uid: record.messageUid,
    summarized: record.summarized === true,
    eligible: shouldMarkCurrentTurnSummarizedMessageInScope(message, emptyScope),
    control,
    injected,
    alwaysRetained: injected && alwaysRetained.has(type),
    groups,
    callIds: [...new Set(calls.map(resolveContextToolCallDeclarationId).filter(Boolean))],
    resultId:
      resolveContextMessageRole(message) === "tool" ? resolveContextToolResultCallId(message) : "",
  };
}

export function createTurnCompletionIndex() {
  const records = new Map();
  const groups = new Map();
  const results = new Map();
  const retainedCalls = new Map();
  const retained = new Map();
  const selected = new Set();
  const unmarked = new Set();
  const invalid = new Map();

  function refresh(position) {
    const record = records.get(position);
    if (!record) return;
    const eligible =
      record.eligible &&
      (record.control || (!record.alwaysRetained && !(retained.get(position) > 0)));
    if (eligible) selected.add(record.uid);
    else selected.delete(record.uid);
    if (eligible && !record.summarized) unmarked.add(record.uid);
    else unmarked.delete(record.uid);
  }
  function retain(position, delta) {
    const count = (retained.get(position) || 0) + delta;
    if (count) retained.set(position, count);
    else retained.delete(position);
    refresh(position);
  }
  function retainCall(id, delta) {
    const count = (retainedCalls.get(id) || 0) + delta;
    if (count) retainedCalls.set(id, count);
    else retainedCalls.delete(id);
    for (const position of results.get(id) || []) {
      if (!records.get(position).injected) retain(position, delta);
    }
  }
  function retainGroup(position, key, delta) {
    if (position === undefined) return;
    const record = records.get(position);
    if (key.startsWith('["injected",')) retain(position, delta);
    else {
      if (!record.injected) retain(position, delta);
      for (const id of record.callIds) retainCall(id, delta);
    }
  }
  function updateGroups(position, record, present) {
    for (const key of record.groups) {
      const index = groups.get(key) || createMessagePositionIndex();
      const previous = index.last();
      index.set(position, present);
      const next = index.last();
      if (previous !== next) {
        retainGroup(previous, key, -1);
        retainGroup(next, key, 1);
      }
      if (next === undefined) groups.delete(key);
      else groups.set(key, index);
    }
  }
  function remove(position) {
    const record = records.get(position);
    if (!record) return;
    updateGroups(position, record, false);
    if (record.resultId) {
      const matches = results.get(record.resultId);
      matches.delete(position);
      if (!matches.size) results.delete(record.resultId);
    }
    records.delete(position);
    invalid.delete(position);
    retained.delete(position);
    selected.delete(record.uid);
    unmarked.delete(record.uid);
  }
  function collectEvidenceResults(position, positions) {
    for (const id of records.get(position).callIds) {
      for (const result of results.get(id) || []) positions.add(result);
    }
  }
  return {
    set(position, record) {
      let next;
      try {
        next = describe(record);
      } catch (error) {
        next = { uid: record.messageUid, groups: new Set(), callIds: [], error };
      }
      remove(position);
      records.set(position, next);
      if (next.error) invalid.set(position, next.error);
      if (next.resultId) {
        const matches = results.get(next.resultId) || new Set();
        matches.add(position);
        results.set(next.resultId, matches);
        if (!next.injected) retain(position, retainedCalls.get(next.resultId) || 0);
      }
      updateGroups(position, next, true);
      refresh(position);
    },
    remove,
    read() {
      if (invalid.size) throw invalid.values().next().value;
      return {
        markedCount: selected.size,
        markedMessageUids: { has: (uid) => selected.has(uid) },
        pendingMessageUids: [...unmarked],
      };
    },
    readCheckpointEvidenceUids() {
      if (invalid.size) throw invalid.values().next().value;
      const positions = new Set();
      for (const [key, index] of groups) {
        if (!key.startsWith(evidenceGroupPrefix)) continue;
        const position = index.last();
        if (position === undefined) continue;
        positions.add(position);
        collectEvidenceResults(position, positions);
      }
      return [...positions]
        .sort((left, right) => left - right)
        .map((position) => records.get(position).uid);
    },
    clear() {
      for (const collection of [
        records,
        groups,
        results,
        retainedCalls,
        retained,
        selected,
        unmarked,
        invalid,
      ])
        collection.clear();
    },
  };
}
