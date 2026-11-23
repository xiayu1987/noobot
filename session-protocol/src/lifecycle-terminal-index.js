/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { storageDigest } from "#storage-digest";
import { isFunction } from "@noobot/shared/value";
import { isTerminalTurnState, isUnsuccessfulTurnState } from "./lifecycle/turn-state.js";
import { assertTurnRecord } from "./lifecycle/turn-record.js";
import { isTurnSnapshotTerminalLimit, TURN_SNAPSHOT_TERMINAL_LIMIT } from "./turn-lifecycle.js";
import {
  isLifecycleIndexPath,
  LIFECYCLE_INDEX_DESCRIPTOR,
  LIFECYCLE_INDEX_ORDER,
  LIFECYCLE_INDEX_PATH_WIDTH as WIDTH,
  lifecycleIndexNodeKey as nodeKey,
} from "./lifecycle-index-path.js";

const VERSION = 1;
export { LIFECYCLE_INDEX_DESCRIPTOR } from "./lifecycle-index-path.js";

export function createLifecycleIndexDescriptor(root) {
  return { version: VERSION, root };
}

export function lifecycleTerminalPosition(turn, error) {
  if (
    !Number.isSafeInteger(turn?.sequence) ||
    turn.sequence < 1 ||
    typeof turn.turnScopeId !== "string" ||
    !turn.turnScopeId
  )
    throw error("Invalid lifecycle index identity");
  return (
    turn.sequence.toString(2).padStart(53, "0") +
    [...storageDigest(turn.turnScopeId)]
      .map((digit) => Number.parseInt(digit, 16).toString(2).padStart(4, "0"))
      .join("")
  );
}

export function isLifecycleTerminalCandidate(turn, hasMessages) {
  return Boolean(
    turn && isTerminalTurnState(turn.state) && (hasMessages || isUnsuccessfulTurnState(turn.state)),
  );
}

export class LifecycleTerminalIndex {
  #error;
  constructor(error) {
    if (!isFunction(error)) throw new TypeError("Lifecycle index requires an error factory");
    this.#error = error;
  }

  async requireDescriptor(get) {
    const descriptor = await get(
      LIFECYCLE_INDEX_DESCRIPTOR.collection,
      LIFECYCLE_INDEX_DESCRIPTOR.key,
    );
    if (
      !descriptor ||
      descriptor.version !== VERSION ||
      Object.keys(descriptor).length !== 2 ||
      (descriptor.root !== null && !isLifecycleIndexPath(descriptor.root))
    )
      throw this.#error("Invalid lifecycle index descriptor");
    return descriptor;
  }

  async #readNode(get, prefix, expectedPrefix) {
    if (!isLifecycleIndexPath(prefix) || !prefix.startsWith(expectedPrefix))
      throw this.#error("Lifecycle index path mismatch");
    const node = await get(LIFECYCLE_INDEX_ORDER, nodeKey(prefix));
    if (!node || node.prefix !== prefix)
      throw this.#error("Lifecycle index node is missing or misplaced");
    if (
      node.kind === "terminal" &&
      prefix.length === WIDTH &&
      lifecycleTerminalPosition(node, this.#error) === prefix &&
      Object.keys(node).length === 4
    )
      return node;
    if (
      node.kind === "branch" &&
      prefix.length < WIDTH &&
      Object.keys(node).length === 4 &&
      isLifecycleIndexPath(node.zero) &&
      isLifecycleIndexPath(node.one) &&
      node.zero.startsWith(prefix + "0") &&
      node.one.startsWith(prefix + "1")
    )
      return node;
    throw this.#error("Invalid lifecycle index node");
  }

  async #update(plan, prefix, bits, candidate, expectedPrefix = "") {
    if (prefix === null) {
      if (candidate === null) return null;
      plan.set(LIFECYCLE_INDEX_ORDER, nodeKey(bits), candidate);
      return bits;
    }
    const node = await this.#readNode((...args) => plan.get(...args), prefix, expectedPrefix);
    let common = 0;
    while (common < prefix.length && prefix[common] === bits[common]) common += 1;
    if (common < prefix.length) {
      if (candidate === null) return prefix;
      const shared = bits.slice(0, common);
      plan.set(LIFECYCLE_INDEX_ORDER, nodeKey(bits), candidate);
      plan.set(LIFECYCLE_INDEX_ORDER, nodeKey(shared), {
        kind: "branch",
        prefix: shared,
        zero: bits[common] === "0" ? bits : prefix,
        one: bits[common] === "1" ? bits : prefix,
      });
      return shared;
    }
    if (node.kind === "terminal") {
      if (candidate !== null && node.turnScopeId !== candidate.turnScopeId)
        throw this.#error("Lifecycle index position ownership conflict");
      if (candidate !== null) return prefix;
      plan.remove(LIFECYCLE_INDEX_ORDER, nodeKey(prefix));
      return null;
    }
    const side = bits[prefix.length] === "0" ? "zero" : "one";
    const child = await this.#update(
      plan,
      node[side],
      bits,
      candidate,
      prefix + bits[prefix.length],
    );
    if (child === node[side]) return prefix;
    if (child === null) {
      plan.remove(LIFECYCLE_INDEX_ORDER, nodeKey(prefix));
      return node[side === "zero" ? "one" : "zero"];
    }
    plan.set(LIFECYCLE_INDEX_ORDER, nodeKey(prefix), { ...node, [side]: child });
    return prefix;
  }

  async prepare(plan, { initialize = false } = {}) {
    const scopes = new Set(
      plan
        .changes()
        .filter(({ collection }) => collection === "lifecycle" || collection === "turns")
        .map(({ key }) => key),
    );
    if (!initialize && !scopes.size) return;
    const descriptor = initialize
      ? createLifecycleIndexDescriptor(null)
      : await this.requireDescriptor((...args) => plan.get(...args));
    let root = descriptor.root;
    for (const scope of scopes) {
      const before = initialize ? null : await plan.read("lifecycle", scope);
      const after = await plan.get("lifecycle", scope);
      const previous =
        !initialize &&
        isLifecycleTerminalCandidate(before, (await plan.read("turns", scope)) !== null)
          ? lifecycleTerminalPosition(before, this.#error)
          : null;
      const next = isLifecycleTerminalCandidate(after, (await plan.get("turns", scope)) !== null)
        ? lifecycleTerminalPosition(after, this.#error)
        : null;
      if (previous === next) continue;
      if (previous !== null) root = await this.#update(plan, root, previous, null);
      if (next !== null)
        root = await this.#update(plan, root, next, {
          kind: "terminal",
          prefix: next,
          sequence: after.sequence,
          turnScopeId: scope,
        });
    }
    if (initialize || root !== descriptor.root)
      plan.set(
        LIFECYCLE_INDEX_DESCRIPTOR.collection,
        LIFECYCLE_INDEX_DESCRIPTOR.key,
        createLifecycleIndexDescriptor(root),
      );
  }

  async read(get, { terminalLimit = TURN_SNAPSHOT_TERMINAL_LIMIT.DEFAULT } = {}) {
    if (!isTurnSnapshotTerminalLimit(terminalLimit))
      throw new TypeError("Lifecycle query requires a bounded terminal limit");
    const { root } = await this.requireDescriptor(get);
    const turns = [];
    const visit = async (prefix, expectedPrefix = "") => {
      if (prefix === null || turns.length >= terminalLimit) return;
      const node = await this.#readNode(get, prefix, expectedPrefix);
      if (node.kind === "branch") {
        await visit(node.one, prefix + "1");
        await visit(node.zero, prefix + "0");
        return;
      }
      const turn = await get("lifecycle", node.turnScopeId);
      if (
        !turn ||
        lifecycleTerminalPosition(turn, this.#error) !== prefix ||
        !isLifecycleTerminalCandidate(turn, (await get("turns", node.turnScopeId)) !== null)
      )
        throw this.#error("Lifecycle index references a missing or ineligible turn");
      assertTurnRecord(turn);
      turns.push(turn);
    };
    await visit(root);
    return turns;
  }
}
