/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { isObjectLike } from "./value.js";
import { runtimeParamFixedReason } from "./runtime-param-policy.js";

let active = null;

export function installRuntimeThresholdSnapshot(snapshot) {
  if (active) throw new Error("runtime threshold snapshot is already installed");
  active = Object.freeze({ ...snapshot, overrides: Object.freeze({ ...snapshot.overrides }) });
}

export function getRuntimeThresholdSnapshot() {
  return active;
}

export function bindRuntimeThresholds(category, defaults, prefix = category) {
  const output = {};
  for (const [name, value] of Object.entries(defaults)) {
    const key = `${prefix}.${name}`;
    if (isObjectLike(value)) output[name] = bindRuntimeThresholds(category, value, key);
    else if (runtimeParamFixedReason(key)) output[name] = value;
    else
      Object.defineProperty(output, name, {
        enumerable: true,
        get: () => {
          if (!active)
            throw new Error(`runtime parameters must be initialized before reading ${key}`);
          return Object.hasOwn(active.overrides, key) ? active.overrides[key] : value;
        },
      });
  }
  return Object.freeze(output);
}
