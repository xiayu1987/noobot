/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { after } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TURN_EVENT } from "@noobot/session-protocol";
import { requireSessionCaller } from "@noobot/shared/session-caller";
import { normalizeSessionEntity } from "../../src/session/entities/session-entity.js";
import { SessionMessageService } from "../../src/session/services/session-message-service.js";
import {
  authorityOutboxDir,
  authorityOutboxJournalPath,
  readAuthorityOutbox,
} from "../../src/session/authority-outbox-store/outbox-journal.js";
import { text } from "@noobot/shared/value";
import { createAcceptedAgentExecution } from "../helpers/accepted-run-identity.js";
import { createTestSessionRequiredFields } from "../helpers/session-message-facts.js";

const now = () => "2026-07-18T00:00:00.000Z";

const sessionDirs = [];

after(() => {
  for (const dir of sessionDirs) rmSync(dir, { recursive: true, force: true });
});

function createSessionDir() {
  const dir = mkdtempSync(join(tmpdir(), "noobot-outbox-"));
  sessionDirs.push(dir);
  return dir;
}

function harness(initial = {}) {
  const sessionDir = createSessionDir();
  let persisted = structuredClone({
    sessionId: "s1",
    parentSessionId: "",
    aggregateVersion: 3,
    ...createTestSessionRequiredFields(),
    ...initial,
  });
  let saveFailure = null;
  const repo = {
    async withSessionMutation(_u, _s, operation) {
      return operation(await this.locateSessionScope());
    },
    async locateSessionScope() {
      return { resolvedParentSessionId: "", sessionDir };
    },
    async findById() {
      return normalizeSessionEntity(structuredClone(persisted), { now });
    },
    async save(_u, next, { expectedAggregateVersion } = {}) {
      assert.equal(expectedAggregateVersion, Number(persisted.aggregateVersion ?? 0));
      if (saveFailure) {
        const error = saveFailure;
        saveFailure = null;
        throw error;
      }
      persisted = structuredClone(normalizeSessionEntity(next, { now }));
    },
  };
  return {
    service: new SessionMessageService({ sessionRepo: repo, now }),
    sessionDir,
    outbox: () => readAuthorityOutbox(sessionDir),
    outboxEntry: async (eventId) =>
      (await readAuthorityOutbox(sessionDir)).find((item) => item.eventId === eventId) || null,
    reload: () => normalizeSessionEntity(structuredClone(persisted), { now }),
    failNextSave: (error = new Error("session_save_failed")) => {
      saveFailure = error;
    },
    failOutboxJournal: () => {
      const journalDir = authorityOutboxDir(sessionDir);
      const journalFile = authorityOutboxJournalPath(sessionDir);
      const snapshot = existsSync(journalFile) ? readFileSync(journalFile) : null;
      rmSync(journalDir, { recursive: true, force: true });
      writeFileSync(journalDir, "");
      return () => {
        rmSync(journalDir, { force: true });
        mkdirSync(journalDir, { recursive: true });
        if (snapshot !== null) writeFileSync(journalFile, snapshot);
      };
    },
  };
}

function newSessionHarness() {
  const sessionDir = createSessionDir();
  let persisted = null;
  const repo = {
    async withSessionMutation(_u, _s, operation) {
      return operation(await this.locateSessionScope());
    },
    async withSessionPlacementMutation(_u, _placement, operation) {
      return operation(await this.locateSessionScope());
    },
    async locateSessionScope() {
      return { resolvedParentSessionId: "", sessionDir };
    },
    async isSessionDeleted() {
      return false;
    },
    createInitialSession({ sessionId, caller }) {
      return normalizeSessionEntity(
        {
          ...createTestSessionRequiredFields(),
          caller: requireSessionCaller(caller),
          sessionId,
          parentSessionId: "",
          aggregateVersion: 0,
          messages: [],
        },
        { now },
      );
    },
    async findById() {
      return persisted ? normalizeSessionEntity(structuredClone(persisted), { now }) : null;
    },
    async save(_u, next, { expectedAggregateVersion, createOnly } = {}) {
      if (createOnly) assert.equal(persisted, null);
      else assert.equal(expectedAggregateVersion, Number(persisted.aggregateVersion ?? 0));
      persisted = structuredClone(normalizeSessionEntity(next, { now }));
    },
  };
  return {
    service: new SessionMessageService({ sessionRepo: repo, now }),
    sessionDir,
    outbox: () => readAuthorityOutbox(sessionDir),
    reload: () => persisted && normalizeSessionEntity(structuredClone(persisted), { now }),
  };
}

const event = (eventType, commandId, expectedRevision, extra = {}) => {
  const action = text(extra.action);
  return {
    userId: "u1",
    sessionId: "s1",
    turnScopeId: "t1",
    dialogProcessId: "dp1",
    messageId: "turn-message-t1",
    presentationMessageId: "presentation-t1",
    eventType,
    commandId,
    causationId: commandId,
    expectedRevision,
    ...(eventType === TURN_EVENT.ACTION_ACCEPTED
      ? {
          ...createAcceptedAgentExecution(extra.turnScopeId ?? "t1", extra.sessionId ?? "s1"),
          startedAt: "2026-07-18T00:00:00.000Z",
        }
      : {}),
    ...extra,
    ...(eventType === TURN_EVENT.ACTION_ACCEPTED && action !== "resend"
      ? {
          userMessage: {
            content: "authoritative user message",
            userMessageId: "um_t1",
            messageOrigin: "natural",
          },
        }
      : {}),
  };
};

const eventIdOf = (envelope) => envelope?.identity?.eventId;
const deliveryReceiptOf = (envelope) => ({
  eventId: eventIdOf(envelope),
  consumerId: "test-authority-consumer",
  orderingDomain: envelope.ordering.domain,
  orderingScopeId: envelope.ordering.scopeId,
  sequence: envelope.ordering.sequence,
});

export { now, createSessionDir, harness, newSessionHarness, event, eventIdOf, deliveryReceiptOf };
