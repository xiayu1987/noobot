/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { commitTurn } from "./session-message-service/commit-turn.js";
import { bindTurnAttachments } from "./session-message-service/bind-turn-attachments.js";
import { appendTurn, appendTurns } from "./session-message-service/append-turn.js";
import { commitMessageEvent } from "./session-message-service/message-event.js";
import { commitAuthorityEvent } from "./session-message-service/authority-event.js";
import { pluginArtifactKey, projectPluginArtifacts } from "@noobot/event-protocol";
import { deleteFromMessage, replaceTurn } from "./session-message-service/turn-mutations.js";
import {
  acknowledgeAuthorityEvent,
  applyTurnLifecycleEvent,
  assertReusedUserTurnIdentity,
  compactAuthorityEvents,
  getPendingAuthorityEvents,
  getTurnLifecycleSnapshot,
  recordAuthorityEventAttempt,
  upsertTurnTiming,
} from "./session-message-service/turn-state.js";
import {
  getSessionTurns,
  getSessionContextSource,
  getTurnSummaryCheckpointState,
  hasDialogProcessIdInSession,
} from "./session-message-service/message-queries.js";
import { commitTurnSummaryCheckpoint } from "./session-message-service/turn-summary-checkpoint.js";

export class SessionMessageService {
  constructor({
    sessionRepo,
    sessionCrudService = null,
    now = () => new Date().toISOString(),
    allocateDialogProcessId = null,
  } = {}) {
    this.sessionRepo = sessionRepo;
    this.sessionCrudService = sessionCrudService;
    this.now = now;
    this.allocateDialogProcessId = allocateDialogProcessId;
    this._mutationTails = new Map();
  }

  async _resolveParentSessionId(
    userId,
    sessionId,
    parentSessionId = "",
    persistenceContext = null,
  ) {
    if (typeof this.sessionRepo?.resolveSessionScope === "function") {
      const scope = await this.sessionRepo.resolveSessionScope(
        userId,
        sessionId,
        parentSessionId,
        persistenceContext,
      );
      return scope?.resolvedParentSessionId || "";
    }
    return this.sessionRepo.resolveParentSessionId(userId, sessionId, parentSessionId);
  }

  async _withSessionMutation(
    userId,
    sessionId,
    operation,
    parentSessionId = "",
    persistenceContext = null,
  ) {
    const scopeKey = persistenceContext?.locationResolver
      ? JSON.stringify(
          await persistenceContext.locationResolver.resolveSessionScope(
            userId,
            sessionId,
            parentSessionId,
          ),
        )
      : "";
    const key = `${String(userId || "").trim()}\u0000${String(sessionId || "").trim()}\u0000${scopeKey}`;
    const previous = this._mutationTails.get(key) || Promise.resolve();
    let release;
    const current = new Promise((resolve) => {
      release = resolve;
    });
    this._mutationTails.set(key, current);
    await previous.then(
      () => undefined,
      () => undefined,
    );
    try {
      if (typeof this.sessionRepo?.withSessionMutation === "function") {
        try {
          return await this.sessionRepo.withSessionMutation(
            userId,
            sessionId,
            parentSessionId,
            operation,
            persistenceContext,
          );
        } catch (error) {
          if (error?.code === "SESSION_DELETED" || error?.errorCode === "SESSION_DELETED") {
            return { appended: false, applied: false, upserted: false, reason: "session_deleted" };
          }
          throw error;
        }
      }
      return await operation();
    } finally {
      release();
      if (this._mutationTails.get(key) === current) this._mutationTails.delete(key);
    }
  }

  async commitTurn(payload = {}) {
    return commitTurn.call(this, payload);
  }
  async bindTurnAttachments(payload = {}) {
    return bindTurnAttachments.call(this, payload);
  }
  async appendTurn(payload = {}) {
    return appendTurn.call(this, payload);
  }
  async appendTurns(payload = {}) {
    return appendTurns.call(this, payload);
  }
  async commitMessageEvent(payload = {}) {
    return commitMessageEvent.call(this, payload);
  }
  async commitAuthorityEvent(payload = {}) {
    return commitAuthorityEvent.call(this, payload);
  }
  async getPluginArtifact(payload = {}) {
    const session = await this.sessionRepo.findById(
      payload.userId,
      payload.sessionId,
      payload.parentSessionId || "",
      payload.persistenceContext || null,
    );
    const key = pluginArtifactKey(payload);
    const current = projectPluginArtifacts(session?.sessionArtifactEvents || [])[key];
    if (!current) return { found: false, artifact: null, revision: 0 };
    return {
      found: true,
      revision: current.revision,
      operation: current.operation,
      artifact: current.data,
      eventId: current.eventId,
    };
  }
  async deleteFromMessage(payload = {}) {
    return deleteFromMessage.call(this, payload);
  }
  async replaceTurn(payload = {}) {
    return replaceTurn.call(this, payload);
  }
  async applyTurnLifecycleEvent(payload = {}) {
    return applyTurnLifecycleEvent.call(this, payload);
  }
  async getTurnLifecycleSnapshot(payload = {}) {
    return getTurnLifecycleSnapshot.call(this, payload);
  }
  async getPendingAuthorityEvents(payload = {}) {
    return getPendingAuthorityEvents.call(this, payload);
  }
  async recordAuthorityEventAttempt(payload = {}) {
    return recordAuthorityEventAttempt.call(this, payload);
  }
  async acknowledgeAuthorityEvent(payload = {}) {
    return acknowledgeAuthorityEvent.call(this, payload);
  }
  async compactAuthorityEvents(payload = {}) {
    return compactAuthorityEvents.call(this, payload);
  }
  async upsertTurnTiming(payload = {}) {
    return upsertTurnTiming.call(this, payload);
  }
  async assertReusedUserTurnIdentity(payload = {}) {
    return assertReusedUserTurnIdentity.call(this, payload);
  }
  async commitTurnSummaryCheckpoint(payload = {}) {
    return commitTurnSummaryCheckpoint.call(this, payload);
  }
  async getSessionTurns(payload = {}) {
    return getSessionTurns.call(this, payload);
  }
  async getSessionContextSource(payload = {}) {
    return getSessionContextSource.call(this, payload);
  }
  async getTurnSummaryCheckpointState(payload = {}) {
    return getTurnSummaryCheckpointState.call(this, payload);
  }
  async hasDialogProcessIdInSession(payload = {}) {
    return hasDialogProcessIdInSession.call(this, payload);
  }
}
