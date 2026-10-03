/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { commitTurn } from "./session-message-service/commit-turn.js";
import { bindTurnAttachments } from "./session-message-service/bind-turn-attachments.js";
import { appendTurns } from "./session-message-service/append-turn.js";
import { commitMessageEvent } from "./session-message-service/message-event.js";
import {
  acknowledgeAuthorityEvents,
  commitAuthorityEvent,
  compactAuthorityEvents,
  getPendingAuthorityEvents,
  recordAuthorityEventAttempts,
} from "./session-message-service/authority-event.js";
import { pluginArtifactKey, projectPluginArtifacts } from "@noobot/event-protocol";
import { deleteFromMessage, replaceTurn } from "./session-message-service/turn-mutations.js";
import {
  applyTurnLifecycleEvent,
  assertReusedUserTurnIdentity,
  getTurnLifecycleSnapshot,
  upsertTurnTiming,
} from "./session-message-service/turn-state.js";
import {
  getSessionTurns,
  getSessionContextSource,
  getTurnSummaryCheckpointState,
  hasDialogProcessIdInSession,
} from "./session-message-service/message-queries.js";
import { commitTurnSummaryCheckpoint } from "./session-message-service/turn-summary-checkpoint.js";
import { readRepositoryParentSessionId } from "./session-scope-resolution.js";

export class SessionMessageService {
  constructor({
    sessionRepo,
    sessionCrudService = null,
    now = () => new Date().toISOString(),
    allocateDialogProcessId,
  } = {}) {
    this.sessionRepo = sessionRepo;
    this.sessionCrudService = sessionCrudService;
    this.now = now;
    this.allocateDialogProcessId = allocateDialogProcessId;
  }

  async _resolveParentSessionId(
    userId,
    sessionId,
    parentSessionId = "",
    persistenceContext = null,
  ) {
    return readRepositoryParentSessionId(
      this.sessionRepo,
      userId,
      sessionId,
      parentSessionId,
      persistenceContext,
    );
  }

  async _findSession(userId, sessionId, parentSessionId = "", persistenceContext = null) {
    const resolvedParentSessionId = await this._resolveParentSessionId(
      userId,
      sessionId,
      parentSessionId,
      persistenceContext,
    );
    const session = await this.sessionRepo.findById(
      userId,
      sessionId,
      resolvedParentSessionId,
      persistenceContext,
    );
    return { session, resolvedParentSessionId };
  }

  async _withSessionMutation(
    userId,
    sessionId,
    operation,
    parentSessionId = "",
    persistenceContext = null,
  ) {
    return this.sessionRepo.withSessionMutation(
      userId,
      sessionId,
      parentSessionId,
      operation,
      persistenceContext,
    );
  }

  async commitTurn(payload = {}) {
    return commitTurn.call(this, payload);
  }
  async bindTurnAttachments(payload = {}) {
    return bindTurnAttachments.call(this, payload);
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
  async recordAuthorityEventAttempts(payload = {}) {
    return recordAuthorityEventAttempts.call(this, payload);
  }
  async acknowledgeAuthorityEvents(payload = {}) {
    return acknowledgeAuthorityEvents.call(this, payload);
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
