/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
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
import {
  createPluginArtifactQueryResult,
  pluginArtifactKey,
  projectPluginArtifacts,
} from "@noobot/event-protocol";
import { createSessionNotFoundError } from "@noobot/session-protocol";
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
import { recordUserMetaParsedResult } from "./session-message-service/user-meta-parsed-result.js";

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

  async bindTurnAttachments(payload = {}) {
    return bindTurnAttachments.call(this, payload);
  }
  async appendTurns(payload = {}) {
    return appendTurns.call(this, payload);
  }
  async commitMessageEvent(payload) {
    return commitMessageEvent.call(this, payload);
  }
  async commitAuthorityEvent(payload) {
    return commitAuthorityEvent.call(this, payload);
  }
  async getPluginArtifact(payload) {
    const session = await this.sessionRepo.findById(payload.userId, payload.sessionId, {
      persistenceContext: payload.persistenceContext,
    });
    if (!session) throw createSessionNotFoundError(payload);
    const projected = projectPluginArtifacts(session.sessionArtifactEvents);
    return createPluginArtifactQueryResult(projected[pluginArtifactKey(payload)] || null);
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
  async commitTurnSummaryCheckpoint(payload) {
    return commitTurnSummaryCheckpoint.call(this, payload);
  }
  async recordUserMetaParsedResult(payload = {}) {
    return recordUserMetaParsedResult.call(this, payload);
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
