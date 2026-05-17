/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { now } from "../utils/session-utils.js";

/**
 * Manage session lifecycle (create, update, close).
 */
export class SessionLifecycleManager {
  /**
   * @param {Object} sessionService - Session service instance
   */
  constructor(sessionService) {
    this.sessionService = sessionService;
  }

  /**
   * Create a new session.
   * @param {string} sessionId - Session identifier
   * @param {Object} context - Execution context
   * @returns {Object} Created session
   */
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

  /**
   * Update session status.
   * @param {string} sessionId - Session identifier
   * @param {string} status - New status
   * @param {Object} metadata - Additional metadata
   * @returns {Object} Updated session
   */
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

  /**
   * Close a session.
   * @param {string} sessionId - Session identifier
   * @param {Object} metadata - Additional metadata
   * @returns {Object} Closed session
   */
  async close(sessionId, metadata = {}) {
    return this.updateStatus(sessionId, "closed", metadata);
  }
}
