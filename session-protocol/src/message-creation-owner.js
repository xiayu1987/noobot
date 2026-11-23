/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { isObjectLike } from "@noobot/shared/value";
import { isPartitionEpoch } from "./partition-epoch.js";

export function isPartitionEntityOwner(owner) {
  return (
    isObjectLike(owner) &&
    Object.getPrototypeOf(owner) === Object.prototype &&
    Reflect.ownKeys(owner).length === 4 &&
    ["epoch", "partition", "sequence", "slot"].every((field) =>
      Object.hasOwn(Object.getOwnPropertyDescriptor(owner, field) ?? {}, "value"),
    ) &&
    isPartitionEpoch(owner.epoch) &&
    Number.isSafeInteger(owner.partition) &&
    owner.partition >= 0 &&
    Number.isSafeInteger(owner.sequence) &&
    owner.sequence >= 1 &&
    Number.isSafeInteger(owner.slot) &&
    owner.slot >= 0
  );
}

export function samePartitionEntityOwner(left, right) {
  return (
    left.epoch === right.epoch &&
    left.partition === right.partition &&
    left.sequence === right.sequence &&
    left.slot === right.slot
  );
}

export function isMessageCreationOwner(owner) {
  return (Number.isSafeInteger(owner) && owner > 0) || isPartitionEntityOwner(owner);
}

export function sameMessageCreationOwner(left, right) {
  return typeof left === "number" || typeof right === "number"
    ? left === right
    : samePartitionEntityOwner(left, right);
}
