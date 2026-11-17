/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { isFunction, isObjectLike } from "./value.js";

const deepFrozenRoots = new WeakSet();

export function isDeepFrozen(value) {
  return deepFrozenRoots.has(value);
}

function freezeNested(value, graph) {
  if (isFunction(value)) graph.stable = false;
  if (!isObjectLike(value) || deepFrozenRoots.has(value) || graph.seen.has(value)) return;
  graph.seen.add(value);
  Object.freeze(value);
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== Array.prototype && prototype !== null)
    graph.stable = false;
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!Object.hasOwn(descriptor, "value")) graph.stable = false;
    if (descriptor.enumerable && typeof key === "string") freezeNested(value[key], graph);
    else if (key === "toJSON") graph.stable = false;
  }
}

export function deepFreeze(value) {
  if (!isObjectLike(value) || deepFrozenRoots.has(value)) return value;
  const graph = { seen: new Set(), stable: true };
  freezeNested(value, graph);
  if (graph.stable) {
    for (const frozen of graph.seen) deepFrozenRoots.add(frozen);
  }
  return value;
}

export function deepFreezeArray(values) {
  const array = Array.from(values);
  let stable = true;
  for (const value of array) {
    deepFreeze(value);
    if (isFunction(value) || (isObjectLike(value) && !isDeepFrozen(value))) stable = false;
  }
  Object.freeze(array);
  if (stable) deepFrozenRoots.add(array);
  return array;
}
