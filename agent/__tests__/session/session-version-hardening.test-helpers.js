/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  initializePartitionReaderFixture,
  openPartitionReaderFixture,
  partitionReaderAccess,
} from "../helpers/partition-reader-fixture.js";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after } from "node:test";
import { TURN_EVENT, TURN_PHASE } from "@noobot/session-protocol";
import { SESSION_CALLER } from "@noobot/shared/session-caller";
import { SessionMessageService } from "../../src/session/services/session-message-service.js";
import { createAcceptedAgentExecution } from "../helpers/accepted-run-identity.js";
import { createSessionCrudServiceStub } from "../helpers/session-crud-service-stub.js";
import { sessionReaderMethods } from "../../src/session/repositories/file-system-session-repository/reader-methods.js";
import {
  applySessionMessageFacts,
  createTestSessionRequiredFields,
} from "../helpers/session-message-facts.js";

const TEST_SESSION_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "noobot-session-dir-"));
after(() => fs.rmSync(TEST_SESSION_DIR, { recursive: true, force: true }));

export async function harness({ fixtureChanges = [], ...initial } = {}) {
  const sessionDir = fs.mkdtempSync(path.join(TEST_SESSION_DIR, "session-"));
  let session = applySessionMessageFacts(
    structuredClone({
      sessionId: "s1",
      parentSessionId: "",
      aggregateVersion: 0,
      ...createTestSessionRequiredFields(),
      ...initial,
    }),
  );
  let lockCalls = 0;
  await initializePartitionReaderFixture({
    sessionDir,
    operationId: "initialize-version-test",
    session,
    fixtureChanges,
  });
  const open = () =>
    openPartitionReaderFixture({ sessionDir, sessionId: "s1", parentSessionId: "" });
  {
    await using reader = await open();
    session = await reader.exportSession();
  }
  const repo = {
    sessionReaderAccess: partitionReaderAccess,
    async withSessionMutation(_u, _s, operation) {
      lockCalls += 1;
      return operation(await this.locateSessionScope());
    },
    async locateSessionScope() {
      return { resolvedParentSessionId: "", sessionDir };
    },
    async ensureSession() {},
    requireSessionReader: open,
    findSessionReader: open,
    async withSessionCommit(userId, sessionId, operation, options) {
      const result = await sessionReaderMethods.withSessionCommit.call(
        this,
        userId,
        sessionId,
        operation,
        options,
      );
      await using reader = await open();
      session = await reader.exportSession();
      return result;
    },
    withSessionReader(userId, sessionId, operation, options) {
      return sessionReaderMethods.withSessionReader.call(
        this,
        userId,
        sessionId,
        async (transaction) => {
          const result = await operation(transaction);
          session = await transaction.readCurrent((reader) => reader.exportSession());
          return result;
        },
        options,
      );
    },
  };
  return {
    service: new SessionMessageService({
      repo,
      sessionRepo: repo,
      sessionCrudService: createSessionCrudServiceStub(() => session),
      now: () => "2026-01-01T00:00:00.000Z",
      allocateDialogProcessId: () => "dialog-replacement",
    }),
    get: () => structuredClone(session),
    locks: () => lockCalls,
  };
}

export async function acceptTurn(
  service,
  { turnScopeId, content = "message", userMessageId = `um_${turnScopeId}`, ...extra },
) {
  const accepted = await service.applyTurnLifecycleEvent({
    userId: "u1",
    sessionId: "s1",
    eventType: TURN_EVENT.ACTION_ACCEPTED,
    sessionCaller: SESSION_CALLER.USER,
    phase: TURN_PHASE.ACTION,
    action: "send",
    turnScopeId,
    commandId: `accept-${turnScopeId}`,
    causationId: `accept-${turnScopeId}`,
    presentationMessageId: `presentation-${turnScopeId}`,
    expectedRevision: 0,
    ...createAcceptedAgentExecution(turnScopeId, extra.sessionId ?? "s1"),
    userMessage: {
      content,
      userMessageId,
      messageOrigin: "natural",
    },
    ...extra,
  });
  if (!accepted.applied) throw new Error(`acceptTurn rejected: ${accepted.reason}`);
  return accepted;
}

export const canonical = (id = "a1") => ({
  attachmentId: id,
  sessionId: "s1",
  attachmentSource: "user",
  name: `${id}.docx`,
  mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  size: 321,
  path: `/workspace/${id}.docx`,
  relations: [
    {
      relationType: "parsed_result",
      sourceIdentity: { attachmentId: id, sessionId: "s1", attachmentSource: "user" },
      targetIdentity: { attachmentId: `${id}-parsed`, sessionId: "s1", attachmentSource: "model" },
      mimeType: "text/markdown",
      createdAt: "2026-08-16T00:00:00.000Z",
    },
  ],
});
