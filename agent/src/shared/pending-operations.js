/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { AsyncLocalStorage } from "node:async_hooks";

export class PendingOperations {
  constructor() {
    this.active = 0;
    this.completionWaiters = new Set();
    this.closed = false;
    this.context = new AsyncLocalStorage();
  }

  async run(operation) {
    if (this.closed && !this.context.getStore()?.active)
      throw Object.assign(new Error("Runtime is closing"), {
        code: "RUNTIME_CLOSED",
        statusCode: 503,
      });
    this.active += 1;
    const lease = { active: true };
    try {
      return await this.context.run(lease, operation);
    } finally {
      lease.active = false;
      this.active -= 1;
      this.#notifyDrained();
    }
  }

  #notifyDrained() {
    if (this.active !== 0) return;
    for (const resolve of this.completionWaiters) resolve();
    this.completionWaiters.clear();
  }

  async drain() {
    while (this.active !== 0)
      await new Promise((resolve) => {
        this.completionWaiters.add(resolve);
      });
  }

  close() {
    this.closed = true;
    return this.drain();
  }
}
