/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  immutableLifecyclePosition,
  isImmutableTerminalCandidate,
  immutableStorageError,
} from "@noobot/session-protocol/immutable-storage";
import {
  isTurnSnapshotTerminalLimit,
  TURN_SNAPSHOT_TERMINAL_LIMIT,
} from "@noobot/session-protocol/turn-lifecycle";
import { assertTurnRecord } from "@noobot/session-protocol";
import { ImmutableSessionChanges } from "./immutable-message-changes.js";
import { ImmutableSessionStore } from "./immutable-session-store.js";

const WIDTH = 309;
const nodeKey = (prefix) => `p:${prefix}`;

async function requireImmutableLifecycleIndex(get) {
  const descriptor = await get("metadata", "lifecycleIndex");
  if (descriptor === null)
    throw Object.assign(new Error("Lifecycle index requires an offline upgrade"), {
      code: "SESSION_IMMUTABLE_INDEX_UPGRADE_REQUIRED",
    });
  if (
    descriptor.version !== 1 ||
    (descriptor.root !== null && !/^[01]{0,309}$/.test(descriptor.root))
  )
    throw immutableStorageError("Invalid lifecycle index descriptor");
  return descriptor;
}

async function readNode(get, prefix, expectedPrefix) {
  if (
    typeof prefix !== "string" ||
    !/^[01]{0,309}$/.test(prefix) ||
    !prefix.startsWith(expectedPrefix)
  )
    throw immutableStorageError("Lifecycle index path mismatch");
  const node = await get("lifecycleOrder", nodeKey(prefix));
  if (!node || node.prefix !== prefix)
    throw immutableStorageError("Lifecycle index node is missing or misplaced");
  if (
    node.kind === "terminal" &&
    prefix.length === WIDTH &&
    immutableLifecyclePosition(node) === prefix &&
    Object.keys(node).length === 4
  )
    return node;
  if (
    node.kind === "branch" &&
    prefix.length < WIDTH &&
    Object.keys(node).length === 4 &&
    typeof node.zero === "string" &&
    /^[01]{1,309}$/.test(node.zero) &&
    typeof node.one === "string" &&
    /^[01]{1,309}$/.test(node.one) &&
    node.zero.startsWith(prefix + "0") &&
    node.one.startsWith(prefix + "1")
  )
    return node;
  throw immutableStorageError("Invalid lifecycle index node");
}

async function update(plan, prefix, bits, candidate, expectedPrefix = "") {
  if (prefix === null) {
    if (candidate === null) return null;
    plan.set("lifecycleOrder", nodeKey(bits), candidate);
    return bits;
  }
  const node = await readNode((...args) => plan.get(...args), prefix, expectedPrefix);
  let common = 0;
  while (common < prefix.length && prefix[common] === bits[common]) common += 1;
  if (common < prefix.length) {
    if (candidate === null) return prefix;
    const shared = bits.slice(0, common);
    plan.set("lifecycleOrder", nodeKey(bits), candidate);
    plan.set("lifecycleOrder", nodeKey(shared), {
      kind: "branch",
      prefix: shared,
      zero: bits[common] === "0" ? bits : prefix,
      one: bits[common] === "1" ? bits : prefix,
    });
    return shared;
  }
  if (node.kind === "terminal") {
    if (node.turnScopeId !== candidate?.turnScopeId && candidate !== null)
      throw immutableStorageError("Lifecycle index position ownership conflict");
    if (candidate !== null) return prefix;
    plan.remove("lifecycleOrder", nodeKey(prefix));
    return null;
  }
  const side = bits[prefix.length] === "0" ? "zero" : "one";
  const child = await update(plan, node[side], bits, candidate, prefix + bits[prefix.length]);
  if (child === node[side]) return prefix;
  if (child === null) {
    plan.remove("lifecycleOrder", nodeKey(prefix));
    return node[side === "zero" ? "one" : "zero"];
  }
  plan.set("lifecycleOrder", nodeKey(prefix), { ...node, [side]: child });
  return prefix;
}

export async function prepareImmutableLifecycleIndex(plan, { initialize = false } = {}) {
  const scopes = new Set(
    plan
      .changes()
      .filter(({ collection }) => collection === "lifecycle" || collection === "turns")
      .map(({ key }) => key),
  );
  if (!initialize && !scopes.size) return;
  const descriptor = initialize
    ? { version: 1, root: null }
    : await requireImmutableLifecycleIndex((...args) => plan.get(...args));
  let root = descriptor.root;
  for (const scope of scopes) {
    const before = initialize ? null : await plan.read("lifecycle", scope);
    const after = await plan.get("lifecycle", scope);
    const beforeCandidate =
      !initialize &&
      isImmutableTerminalCandidate(before, (await plan.read("turns", scope)) !== null);
    const afterCandidate = isImmutableTerminalCandidate(
      after,
      (await plan.get("turns", scope)) !== null,
    );
    const previousPosition = beforeCandidate ? immutableLifecyclePosition(before) : null;
    const nextPosition = afterCandidate ? immutableLifecyclePosition(after) : null;
    if (previousPosition === nextPosition) continue;
    if (previousPosition !== null) root = await update(plan, root, previousPosition, null);
    if (nextPosition !== null)
      root = await update(plan, root, nextPosition, {
        kind: "terminal",
        prefix: nextPosition,
        sequence: after.sequence,
        turnScopeId: scope,
      });
  }
  if (initialize || root !== descriptor.root)
    plan.set("metadata", "lifecycleIndex", { version: 1, root });
}

export async function readImmutableLifecycleTurns(
  get,
  { terminalLimit = TURN_SNAPSHOT_TERMINAL_LIMIT.DEFAULT } = {},
) {
  if (!isTurnSnapshotTerminalLimit(terminalLimit))
    throw new TypeError("Lifecycle query requires a bounded terminal limit");
  const { root } = await requireImmutableLifecycleIndex(get);
  const turns = [];
  async function visit(prefix, expectedPrefix = "") {
    if (prefix === null || turns.length >= terminalLimit) return;
    const node = await readNode(get, prefix, expectedPrefix);
    if (node.kind === "branch") {
      await visit(node.one, prefix + "1");
      await visit(node.zero, prefix + "0");
      return;
    }
    const turn = await get("lifecycle", node.turnScopeId);
    if (
      !turn ||
      immutableLifecyclePosition(turn) !== prefix ||
      !isImmutableTerminalCandidate(turn, (await get("turns", node.turnScopeId)) !== null)
    )
      throw immutableStorageError("Lifecycle index references a missing or ineligible turn");
    assertTurnRecord(turn);
    turns.push(turn);
  }
  await visit(root);
  return turns;
}

export async function upgradeImmutableLifecycleIndex({ sessionDir, sessionId }) {
  const store = await ImmutableSessionStore.open({ sessionDir, sessionId });
  const snapshot = await store.snapshot();
  return store.transact({
    expectedGeneration: snapshot.generation,
    operationId: `upgrade-lifecycle-index:${snapshot.generation}`,
    input: {},
    prepare: async ({ get, snapshot: pinned }) => {
      if (await get("metadata", "lifecycleIndex")) {
        await requireImmutableLifecycleIndex(get);
        return { abort: true, changes: [], result: { upgraded: false } };
      }
      const plan = new ImmutableSessionChanges(get);
      for await (const [scope, turn] of store.entries(pinned, "lifecycle")) {
        assertTurnRecord(turn);
        if (turn.turnScopeId !== scope)
          throw immutableStorageError("Lifecycle upgrade ownership mismatch");
        plan.set("lifecycle", scope, turn);
      }
      await prepareImmutableLifecycleIndex(plan, { initialize: true });
      return {
        changes: plan.changes().filter(({ collection }) => collection !== "lifecycle"),
        result: { upgraded: true },
      };
    },
  });
}
