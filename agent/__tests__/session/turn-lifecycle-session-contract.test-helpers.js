/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TURN_EVENT, createSessionNotFoundError } from "@noobot/session-protocol";
import { SESSION_CALLER, requireSessionCaller } from "@noobot/shared/session-caller";
import { normalizeSessionEntity } from "../../src/session/entities/session-entity.js";
import { SessionMessageService } from "../../src/session/services/session-message-service.js";
import { text } from "@noobot/shared/value";
import { createAcceptedAgentExecution } from "../helpers/accepted-run-identity.js";
import { createTestSessionRequiredFields } from "../helpers/session-message-facts.js";
import {
  createImmutableSession,
  initializeImmutableSession,
} from "../../src/session/session-artifact-session/immutable-session-bootstrap.js";
import {
  openImmutableSessionReader,
  withImmutableSessionReader,
} from "../../src/session/session-artifact-session/immutable-session-reader.js";
import { immutableSessionReaderAccess } from "../../src/session/session-artifact-session/immutable-reader-access.js";
import { ImmutableSessionStore } from "../../src/session/session-artifact-session/immutable-session-store.js";
import {
  fullSessionTurnViews,
  requiredSessionReads,
} from "../helpers/session-repo-required-reads.js";

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
  const initialized = initializeImmutableSession({
    sessionDir,
    session: persisted,
    operationId: "test-seed-session",
  });
  let saveFailure = null;
  let outboxFailure = false;
  const scope = { sessionDir, sessionId: "s1", parentSessionId: "" };
  const persist = async (request, commit, refresh) => {
    if (saveFailure) {
      const error = saveFailure;
      saveFailure = null;
      throw error;
    }
    if (outboxFailure) throw new Error("outbox_commit_failed");
    const result = await commit(request);
    persisted = await refresh();
    return result;
  };
  const repo = {
    async withSessionMutation(_u, _s, operation) {
      return operation(await this.locateSessionScope());
    },
    async locateSessionScope() {
      await initialized;
      return { resolvedParentSessionId: "", sessionDir };
    },
    ...requiredSessionReads,
    ...fullSessionTurnViews,
    async requireSessionReader() {
      await initialized;
      return openImmutableSessionReader({ sessionDir, sessionId: "s1", parentSessionId: "" });
    },
    async withSessionOutboxMutation(_u, _s, plan) {
      await initialized;
      return immutableSessionReaderAccess.withOutboxMutation(scope, async (reader) => {
        const complete = await plan(reader);
        return (commit) =>
          complete((request) =>
            persist(request, commit, async () => {
              await using current = await openImmutableSessionReader(scope);
              return current.exportSession();
            }),
          );
      });
    },
    async withSessionReader(_u, _s, operation) {
      await initialized;
      return withImmutableSessionReader(scope, (reader, commitChanges, readCurrent) =>
        operation({
          reader,
          scope: { resolvedParentSessionId: "", sessionDir },
          commitChanges: (request) =>
            persist(request, commitChanges, () =>
              readCurrent((current) => current.exportSession()),
            ),
          readCurrent,
        }),
      );
    },
    async findSessionReader() {
      return this.requireSessionReader();
    },
    async findById() {
      return normalizeSessionEntity(structuredClone(persisted));
    },
    async findTurnLifecycleSource() {
      return {
        ...structuredClone(persisted),
        messageTurnScopeIds: persisted.messages.map((message) => message.turnScopeId),
      };
    },
  };
  return {
    service: new SessionMessageService({
      sessionRepo: repo,
      now,
      allocateDialogProcessId: () => "dp1",
    }),
    sessionDir,
    outbox: async () => {
      await initialized;
      const store = new ImmutableSessionStore({ sessionDir, sessionId: "s1" });
      const snapshot = await store.snapshot();
      const events = [];
      for await (const [, value] of store.entries(snapshot, "outbox")) events.push(value);
      return events.sort((a, b) => a.ordinal - b.ordinal);
    },
    outboxEntry: async (eventId) => (await repo.requireSessionReader()).readOutboxEvent(eventId),
    reload: () => normalizeSessionEntity(structuredClone(persisted)),
    failNextSave: (error = new Error("session_save_failed")) => {
      saveFailure = error;
    },
    failOutboxCommit: () => {
      outboxFailure = true;
      return () => {
        outboxFailure = false;
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
      return normalizeSessionEntity({
        ...createTestSessionRequiredFields(),
        caller: requireSessionCaller(caller),
        sessionId,
        parentSessionId: "",
        aggregateVersion: 0,
        messages: [],
      });
    },
    ...requiredSessionReads,
    ...fullSessionTurnViews,
    async requireSessionReader() {
      if (!persisted) throw createSessionNotFoundError({ userId: "u1", sessionId: "s1" });
      return openImmutableSessionReader({ sessionDir, sessionId: "s1", parentSessionId: "" });
    },
    async withSessionReader(_u, _s, operation) {
      if (!persisted) throw createSessionNotFoundError({ userId: "u1", sessionId: "s1" });
      return withImmutableSessionReader(
        { sessionDir, sessionId: "s1", parentSessionId: "" },
        (reader, commitChanges, readCurrent) =>
          operation({
            reader,
            scope: { resolvedParentSessionId: "", sessionDir },
            commitChanges: async (request) => {
              const result = await commitChanges(request);
              persisted = await readCurrent((current) => current.exportSession());
              return result;
            },
            readCurrent,
          }),
      );
    },
    async findSessionReader() {
      return persisted ? this.requireSessionReader() : null;
    },
    async recoverSessionPlacement() {
      return this.findSessionReader();
    },
    async findById() {
      return persisted ? normalizeSessionEntity(structuredClone(persisted)) : null;
    },
    async createStoredSession(_u, session, { initialTurn, scopedMetadata }) {
      assert.equal(persisted, null);
      const result = await createImmutableSession({
        scope: { sessionDir, sessionId: "s1", parentSessionId: "" },
        session,
        operationId: "test-initial-creation",
        initialTurn,
        scopedMetadata,
      });
      await using reader = await openImmutableSessionReader({
        sessionDir,
        sessionId: "s1",
        parentSessionId: "",
      });
      persisted = await reader.exportSession();
      return result;
    },
  };
  return {
    service: new SessionMessageService({
      sessionRepo: repo,
      now,
      allocateDialogProcessId: () => "dp1",
    }),
    sessionDir,
    outbox: async () =>
      (await (await repo.requireSessionReader()).readOutboxPage({ consumerId: "test-consumer" }))
        .events,
    reload: () => persisted && normalizeSessionEntity(structuredClone(persisted)),
  };
}

const event = (eventType, commandId, expectedRevision, extra = {}) => {
  const action = text(extra.action);
  const userAcceptance = eventType === TURN_EVENT.ACTION_ACCEPTED && action !== "resend";
  return {
    userId: "u1",
    sessionId: "s1",
    turnScopeId: "t1",
    ...(userAcceptance ? { sessionCaller: SESSION_CALLER.USER } : { dialogProcessId: "dp1" }),
    presentationMessageId: "presentation-t1",
    eventType,
    commandId,
    causationId: commandId,
    expectedRevision,
    ...(eventType === TURN_EVENT.ACTION_ACCEPTED
      ? {
          ...createAcceptedAgentExecution(extra.turnScopeId ?? "t1", extra.sessionId ?? "s1"),
        }
      : {}),
    ...extra,
    ...(userAcceptance
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
