/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  assertConnectorInstanceImplementation,
  projectConnectorInstanceDefinition,
} from "@noobot/connector-protocol";

export class ConnectorInstanceRegistry {
  constructor() {
    this.implementations = new Map();
  }

  register(implementation = {}) {
    assertConnectorInstanceImplementation(implementation);
    const instanceType = implementation.definition.instanceType;
    if (this.implementations.has(instanceType)) {
      throw new TypeError(`connector instance is already registered: ${instanceType}`);
    }
    this.implementations.set(instanceType, implementation);
    return projectConnectorInstanceDefinition(implementation.definition);
  }

  require(instanceType = "") {
    const normalizedType = String(instanceType || "").trim();
    const implementation = this.implementations.get(normalizedType);
    if (!implementation)
      throw new TypeError(`connector instance is not registered: ${normalizedType}`);
    return implementation;
  }

  list() {
    return [...this.implementations.values()].map((item) =>
      projectConnectorInstanceDefinition(item.definition),
    );
  }
}
