/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { bindTurnAttachments } from "./session-message-service/bind-turn-attachments.js";
import { withSessionDialogMessageRecords } from "./session-message-service/dialog-message-stream.js";
import { appendTurns } from "./session-message-service/append-turn.js";
import { commitMessageEvent } from "./session-message-service/message-event.js";
import {
  acknowledgeAuthorityEvents,
  commitAuthorityEvent,
  compactAuthorityEvents,
  getPendingAuthorityEvents,
  prepareAuthorityEventDelivery,
} from "./session-message-service/authority-event.js";
import { createPluginArtifactQueryResult } from "@noobot/event-protocol";
import { deleteFromMessage, replaceTurn } from "./session-message-service/turn-mutations.js";
import {
  applyTurnLifecycleEvent,
  assertReusedUserTurnIdentity,
  getTurnLifecycleSnapshot,
  upsertTurnTiming,
} from "./session-message-service/turn-state.js";
import {
  getSessionTurnMessagePage,
  getSessionMessageSources,
  getSessionMessageContentPage,
  getSessionContextSource,
  getTurnSummaryCheckpointState,
} from "./session-message-service/message-queries.js";
import { commitTurnSummaryCheckpoint } from "./session-message-service/turn-summary-checkpoint.js";
import { recordUserMetaParsedResult } from "./session-message-service/user-meta-parsed-result.js";
import { isFunction } from "@noobot/shared/value";

export class SessionMessageService {
  constructor({ sessionRepo, sessionCrudService, now, allocateDialogProcessId } = {}) {
    if (!isFunction(now)) throw new TypeError("SessionMessageService requires now function");
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
    await using reader = await this.sessionRepo.requireSessionReader(
      payload.userId,
      payload.sessionId,
      { persistenceContext: payload.persistenceContext },
    );
    return createPluginArtifactQueryResult(await reader.readPluginArtifact(payload));
  }
  async deleteFromMessage(payload = {}) {
    return deleteFromMessage.call(this, payload);
  }
  async replaceTurn(payload = {}) {
    return replaceTurn.call(this, payload);
  }
  async applyTurnLifecycleEvent(payload) {
    return applyTurnLifecycleEvent.call(this, payload);
  }
  async getTurnLifecycleSnapshot(payload = {}) {
    return getTurnLifecycleSnapshot.call(this, payload);
  }
  async getPendingAuthorityEvents(payload = {}) {
    return getPendingAuthorityEvents.call(this, payload);
  }
  async prepareAuthorityEventDelivery(payload = {}) {
    return prepareAuthorityEventDelivery.call(this, payload);
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
  async getSessionTurnMessagePage(payload = {}) {
    return getSessionTurnMessagePage.call(this, payload);
  }
  async withSessionDialogMessageRecords(payload, consume) {
    return withSessionDialogMessageRecords.call(this, payload, consume);
  }
  async getSessionContextSource(payload = {}) {
    return getSessionContextSource.call(this, payload);
  }
  async getSessionMessageSources(payload) {
    return getSessionMessageSources.call(this, payload);
  }
  async getSessionMessageContentPage(payload) {
    return getSessionMessageContentPage.call(this, payload);
  }
  async getTurnSummaryCheckpointState(payload = {}) {
    return getTurnSummaryCheckpointState.call(this, payload);
  }
}
