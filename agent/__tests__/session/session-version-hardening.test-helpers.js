/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { SessionMessageService } from "../../src/session/services/session-message-service.js";

export function harness(initial = {}) {
  let session = structuredClone({
    sessionId: "s1",
    parentSessionId: "",
    aggregateVersion: 0,
    messages: [],
    turnLifecycle: { turns: {}, commandReceipts: [] },
    ...initial,
  });
  let lockCalls = 0;
  const repo = {
    async withSessionMutation(_u, _s, _p, operation) {
      lockCalls += 1;
      return operation();
    },
    async resolveParentSessionId() {
      return "";
    },
    async ensureSession() {},
    async findById() {
      return structuredClone(session);
    },
    async save(_u, next, _p, { expectedAggregateVersion } = {}) {
      const actual = Number(session.aggregateVersion ?? 0);
      if (expectedAggregateVersion != null && Number(expectedAggregateVersion) !== actual) {
        const error = new Error("session version conflict");
        error.statusCode = 409;
        error.errorCode = "SESSION_AGGREGATE_VERSION_CONFLICT";
        error.currentVersion = actual;
        throw error;
      }
      session = structuredClone(next);
    },
  };
  return {
    service: new SessionMessageService({
      repo,
      sessionRepo: repo,
      now: () => "2026-01-01T00:00:00.000Z",
      allocateDialogProcessId: () => "dialog-replacement",
    }),
    get: () => structuredClone(session),
    locks: () => lockCalls,
  };
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
