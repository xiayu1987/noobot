/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { now } from "../utils/session-utils.js";

/**
 * Persist messages for session execution.
 */
export class MessagePersister {
  /**
   * @param {Object} messageService - Message service instance
   */
  constructor(messageService) {
    this.messageService = messageService;
  }

  /**
   * Persist messages for a session.
   * @param {string} sessionId - Session identifier
   * @param {Object} input - User input
   * @param {Object} options - Additional options
   * @returns {Array} Persisted messages
   */
  async persist(sessionId, input, options = {}) {
    const messages = [];

    // Persist user message
    const userMessage = await this._persistMessage(sessionId, {
      role: "user",
      content: input.content || input.contentText,
      timestamp: now(),
      ...options,
    });
    messages.push(userMessage);

    return messages;
  }

  /**
   * Persist a single message.
   * @param {string} sessionId - Session identifier
   * @param {Object} message - Message object
   * @returns {Object} Persisted message
   */
  async _persistMessage(sessionId, message) {
    if (this.messageService) {
      return await this.messageService.save(sessionId, message);
    }
    return { ...message, id: `msg_${Date.now()}` };
  }
}
