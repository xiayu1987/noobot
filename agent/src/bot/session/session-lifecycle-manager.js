/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { now } from "../utils/session-utils.js";

export class SessionLifecycleManager {
  constructor(sessionService) {
    this.sessionService = sessionService;
  }

  async create(sessionId, context) {
    const session = {
      id: sessionId,
      status: "active",
      context,
      createdAt: now(),
      updatedAt: now(),
    };

    if (this.sessionService) {
      return await this.sessionService.create(session);
    }
    return session;
  }

  async updateStatus(sessionId, status, metadata = {}) {
    const session = {
      id: sessionId,
      status,
      ...metadata,
      updatedAt: now(),
    };

    if (this.sessionService) {
      return await this.sessionService.update(sessionId, session);
    }
    return session;
  }

  async close(sessionId, metadata = {}) {
    return this.updateStatus(sessionId, "closed", metadata);
  }
}
