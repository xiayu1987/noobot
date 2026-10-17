/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
export * from "./definitions.js";
export { BUILTIN_CONNECTOR_INSTANCES } from "./implementations.js";

import { BUILTIN_CONNECTOR_INSTANCES } from "./implementations.js";
import { isFunction } from "@noobot/shared/value";

export function registerBuiltinConnectorInstances(
  runtime,
  instances = BUILTIN_CONNECTOR_INSTANCES,
) {
  if (!runtime || !isFunction(runtime.register)) {
    throw new TypeError("connector runtime is required");
  }
  return instances.map((implementation) => runtime.register(implementation));
}
