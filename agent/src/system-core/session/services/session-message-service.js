/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { commitTurn } from "./session-message-service/commit-turn.js";
import { appendTurn } from "./session-message-service/append-turn.js";
import { deleteFromMessage, replaceTurn } from "./session-message-service/turn-mutations.js";
import { upsertTurnStatus, upsertTurnTiming, stampReusedUserTurnDialogProcessId } from "./session-message-service/turn-state.js";
import { markSessionMessagesSummarized, getSessionTurns, hasDialogProcessIdInSession } from "./session-message-service/message-queries.js";

export class SessionMessageService {
  constructor({ sessionRepo, sessionCrudService = null, now = () => new Date().toISOString() } = {}) {
    this.sessionRepo = sessionRepo;
    this.sessionCrudService = sessionCrudService;
    this.now = now;
    this._mutationTails = new Map();
  }

  async _withSessionMutation(userId, sessionId, operation) {
    const key = `${String(userId || "").trim()}\u0000${String(sessionId || "").trim()}`;
    const previous = this._mutationTails.get(key) || Promise.resolve();
    let release;
    const current = new Promise((resolve) => { release = resolve; });
    this._mutationTails.set(key, current);
    await previous.catch(() => {});
    try {
      if (typeof this.sessionRepo?.withSessionMutation === "function") {
        return await this.sessionRepo.withSessionMutation(userId, sessionId, "", operation);
      }
      return await operation();
    } finally {
      release();
      if (this._mutationTails.get(key) === current) this._mutationTails.delete(key);
    }
  }

  async commitTurn(payload = {}) { return commitTurn.call(this, payload); }
  async appendTurn(payload = {}) { return appendTurn.call(this, payload); }
  async deleteFromMessage(payload = {}) { return deleteFromMessage.call(this, payload); }
  async replaceTurn(payload = {}) { return replaceTurn.call(this, payload); }
  async upsertTurnStatus(payload = {}) { return upsertTurnStatus.call(this, payload); }
  async upsertTurnTiming(payload = {}) { return upsertTurnTiming.call(this, payload); }
  async stampReusedUserTurnDialogProcessId(payload = {}) { return stampReusedUserTurnDialogProcessId.call(this, payload); }
  async markSessionMessagesSummarized(payload = {}) { return markSessionMessagesSummarized.call(this, payload); }
  async getSessionTurns(payload = {}) { return getSessionTurns.call(this, payload); }
  async hasDialogProcessIdInSession(payload = {}) { return hasDialogProcessIdInSession.call(this, payload); }
}
