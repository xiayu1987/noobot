/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { isFunction } from "@noobot/shared/value";
import { IMMUTABLE_TRANSACTION_BUDGET } from "@noobot/session-protocol/immutable-storage-graph";

export class ImmutableTransactionGraph {
  constructor(requireReference) {
    if (!isFunction(requireReference))
      throw new TypeError("Transaction graph requires its storage reference contract");
    this.requireReference = requireReference;
    this.objects = new Map();
    this.references = new Map();
    this.bytes = 0;
  }

  put(reference, bytes) {
    this.requireReference(reference);
    if (this.objects.has(reference)) return;
    if (
      this.bytes + bytes.length > IMMUTABLE_TRANSACTION_BUDGET.bytes ||
      this.objects.size === IMMUTABLE_TRANSACTION_BUDGET.objects
    )
      throw Object.assign(new Error("Immutable transaction staging budget exceeded"), {
        code: "SESSION_TRANSACTION_BUDGET_EXCEEDED",
      });
    this.objects.set(reference, bytes);
    this.bytes += bytes.length;
  }

  link(reference, references) {
    this.requireReference(reference);
    const children = references.filter((child) => child !== null).map(this.requireReference);
    if (!this.references.has(reference)) this.references.set(reference, new Set());
    const edges = this.references.get(reference);
    for (const child of children) edges.add(child);
  }

  reachable(roots) {
    if (!Array.isArray(roots)) throw new TypeError("Publication requires explicit roots");
    const pending = roots.filter((root) => root !== null).map(this.requireReference);
    const visited = new Set();
    const objects = [];
    while (pending.length) {
      const reference = pending.pop();
      if (visited.has(reference) || !this.objects.has(reference)) continue;
      visited.add(reference);
      objects.push({ reference, bytes: this.objects.get(reference) });
      for (const child of this.references.get(reference) ?? []) pending.push(child);
    }
    return objects;
  }

  clear() {
    this.objects.clear();
    this.references.clear();
    this.bytes = 0;
  }
}
