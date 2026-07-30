/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { now } from "../utils/session-utils.js";

export class MessagePersister {
  constructor(messageService) {
    this.messageService = messageService;
  }

  async persist(sessionId, input, options = {}) {
    const messages = [];

    const userMessage = await this._persistMessage(sessionId, {
      role: "user",
      content: input.content || input.contentText,
      timestamp: now(),
      ...options,
    });
    messages.push(userMessage);

    return messages;
  }

  async appendExecutionLog(payload = {}) {
    if (typeof this.messageService?.appendExecutionLog === "function") {
      await this.messageService.appendExecutionLog(payload);
      return true;
    }
    return false;
  }

  async appendTurn(payload = {}) {
    if (typeof this.messageService?.appendTurn === "function") {
      await this.messageService.appendTurn(payload);
      return true;
    }
    return false;
  }

  async appendTurns(payload = {}) {
    if (typeof this.messageService?.appendTurns === "function") {
      return this.messageService.appendTurns(payload);
    }
    const turns = Array.isArray(payload?.turns) ? payload.turns : [];
    const results = [];
    for (const turn of turns) {
      results.push(await this.appendTurn({ ...turn, persistenceContext: payload.persistenceContext }));
    }
    return results;
  }

  async _persistMessage(sessionId, message) {
    if (this.messageService?.save) {
      return await this.messageService.save(sessionId, message);
    }
    return { ...message, id: `msg_${Date.now()}` };
  }
}
