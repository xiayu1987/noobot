import test from "node:test";
import assert from "node:assert/strict";

import { SessionMessageService } from "../../../src/system-core/session/services/session-message-service.js";

function createService({ initialSession }) {
  const saved = [];
  let currentSession = structuredClone(initialSession);
  const sessionRepo = {
    async resolveParentSessionId() {
      return currentSession?.parentSessionId || "";
    },
    async findById() {
      return currentSession;
    },
    async save(_userId, session) {
      currentSession = structuredClone(session);
      saved.push(structuredClone(session));
    },
  };
  const service = new SessionMessageService({
    sessionRepo,
    now: () => "2026-06-17T00:00:00.000Z",
  });
  return { service, saved, getSession: () => currentSession };
}

test("SessionMessageService.deleteFromMessage deletes from anchor message to session tail", async () => {
  const { service, saved } = createService({
    initialSession: {
      sessionId: "s1",
      parentSessionId: "",
      version: 2,
      revision: 2,
      messages: [
        { turnScopeId: "scope-keep", role: "user", content: "keep" },
        { turnScopeId: "scope-delete", role: "assistant", content: "delete" },
        { turnScopeId: "scope-tail", role: "user", content: "delete too" },
      ],
    },
  });

  const result = await service.deleteFromMessage({
    userId: "u1",
    sessionId: "s1",
    anchor: { turnScopeId: "scope-delete" },
    expectedVersion: 2,
  });

  assert.equal(result.deletedCount, 2);
  assert.equal(result.anchorIndex, 1);
  assert.equal(result.version, 3);
  assert.equal(saved.length, 1);
  assert.deepEqual(saved[0].messages.map((message) => message.content), ["keep"]);
  assert.equal(saved[0].version, 3);
  assert.equal(saved[0].revision, 3);
  assert.equal(saved[0].updatedAt, "2026-06-17T00:00:00.000Z");
});

test("SessionMessageService.deleteFromMessage returns 404 when anchor is missing", async () => {
  const { service, saved } = createService({
    initialSession: {
      sessionId: "s1",
      parentSessionId: "",
      version: 1,
      messages: [{ turnScopeId: "scope-keep", role: "user", content: "keep" }],
    },
  });

  await assert.rejects(
    service.deleteFromMessage({
      userId: "u1",
      sessionId: "s1",
      anchor: { turnScopeId: "missing" },
    }),
    (error) => error?.statusCode === 404 && /anchor not found/.test(error.message),
  );
  assert.equal(saved.length, 0);
});

test("SessionMessageService.deleteFromMessage matches dialogProcessId against legacy dialogId", async () => {
  const { service, saved } = createService({
    initialSession: {
      sessionId: "s1",
      parentSessionId: "",
      version: 1,
      revision: 1,
      messages: [
        { turnScopeId: "scope-keep", role: "user", content: "keep" },
        { dialogId: "dp-legacy", role: "assistant", content: "delete" },
        { turnScopeId: "scope-tail", role: "user", content: "delete too" },
      ],
    },
  });

  const result = await service.deleteFromMessage({
    userId: "u1",
    sessionId: "s1",
    anchor: { dialogProcessId: "dp-legacy" },
  });

  assert.equal(result.deletedCount, 2);
  assert.equal(result.anchorIndex, 1);
  assert.deepEqual(saved[0].messages.map((message) => message.content), ["keep"]);
});

test("SessionMessageService.deleteFromMessage returns 409 when expectedVersion conflicts", async () => {
  const { service, saved } = createService({
    initialSession: {
      sessionId: "s1",
      parentSessionId: "",
      version: 5,
      revision: 5,
      messages: [{ turnScopeId: "scope-keep", role: "user", content: "keep" }],
    },
  });

  await assert.rejects(
    service.deleteFromMessage({
      userId: "u1",
      sessionId: "s1",
      anchor: { turnScopeId: "scope-keep" },
      expectedVersion: 4,
    }),
    (error) => error?.statusCode === 409 && error?.currentVersion === 5,
  );
  assert.equal(saved.length, 0);
});

test("SessionMessageService.markUserMessageMonotonic persists stopped monotonic marker on matching user turn", async () => {
  const { service, saved } = createService({
    initialSession: {
      sessionId: "s1",
      parentSessionId: "",
      version: 7,
      revision: 7,
      messages: [
        { turnScopeId: "scope-old", role: "user", content: "old", dialogProcessId: "dp-old" },
        { turnScopeId: "scope-old", role: "assistant", content: "old answer", dialogProcessId: "dp-old" },
        { turnScopeId: "scope-stop", role: "user", content: "stop me", dialogProcessId: "dp-stop" },
      ],
    },
  });

  const result = await service.markUserMessageMonotonic({
    userId: "u1",
    sessionId: "s1",
    dialogProcessId: "dp-stop",
  });

  assert.equal(result.marked, true);
  assert.equal(result.messageIndex, 2);
  assert.equal(saved.length, 1);
  assert.equal(saved[0].messages[2].isMonotonic, true);
  assert.equal(saved[0].messages[2].monotonic, true);
  assert.equal(saved[0].messages[2].monotonicState, "monotonic");
  assert.equal(saved[0].messages[2].stopState, "stopped");
  assert.equal(saved[0].messages[2].state, "stopped");
  assert.equal(saved[0].version, 8);
  assert.equal(saved[0].revision, 8);
});
