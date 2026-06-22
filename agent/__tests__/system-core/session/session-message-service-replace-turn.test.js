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
    now: () => "2026-06-22T00:00:00.000Z",
  });
  return { service, saved, getSession: () => currentSession };
}

function baseSession(overrides = {}) {
  return {
    sessionId: "s1",
    parentSessionId: "",
    version: 2,
    revision: 2,
    messages: [
      { messageId: "m-keep", turnId: "turn-keep", role: "user", content: "keep", dialogProcessId: "dp-keep" },
      { messageId: "m-user", turnId: "turn-old", role: "user", content: "old", dialogProcessId: "dp-old" },
      { messageId: "m-assistant", turnId: "turn-old", role: "assistant", content: "old answer", dialogProcessId: "dp-old" },
      { messageId: "m-tail", turnId: "turn-tail", role: "user", content: "tail" },
    ],
    ...overrides,
  };
}

test("SessionMessageService.replaceTurn matches turnId and returns snapshot without old tail", async () => {
  const { service, saved } = createService({ initialSession: baseSession() });

  const result = await service.replaceTurn({
    userId: "u1",
    sessionId: "s1",
    anchor: { turnId: "turn-old" },
    newContent: "edited",
    expectedVersion: 2,
    idempotencyKey: "idem-1",
  });

  assert.equal(result.deletedCount, 3);
  assert.equal(result.anchorIndex, 1);
  assert.equal(result.turnStartIndex, 1);
  assert.equal(result.version, 3);
  assert.equal(result.idempotencyKey, "idem-1");
  assert.equal(saved.length, 1);
  assert.deepEqual(saved[0].messages.map((message) => message.content), ["keep", "edited"]);
  assert.equal(saved[0].messages[1].role, "user");
  assert.ok(saved[0].messages[1].turnId);
  assert.notEqual(saved[0].messages[1].turnId, "turn-old");
  assert.ok(saved[0].messages[1].messageId);
  assert.equal(saved[0].messages[1].dialogProcessId, "dp-old");
  assert.equal(saved[0].version, 3);
  assert.equal(saved[0].revision, 3);
  assert.equal(saved[0].updatedAt, "2026-06-22T00:00:00.000Z");
});

test("SessionMessageService.replaceTurn matches messageId/id and ts anchors", async () => {
  const { service: messageIdService, saved: messageIdSaved } = createService({
    initialSession: baseSession({ messages: [
      { id: "legacy-id", role: "user", content: "old", dialogProcessId: "dp-id" },
      { messageId: "m2", role: "assistant", content: "old answer", dialogProcessId: "dp-id" },
    ] }),
  });
  await messageIdService.replaceTurn({ userId: "u1", sessionId: "s1", anchor: { id: "legacy-id" }, newContent: "by id" });
  assert.deepEqual(messageIdSaved[0].messages.map((message) => message.content), ["by id"]);

  const { service: tsService, saved: tsSaved } = createService({
    initialSession: baseSession({ messages: [
      { messageId: "m1", role: "user", content: "old", ts: "ts-user" },
      { messageId: "m2", role: "assistant", content: "old answer", ts: "ts-assistant" },
    ] }),
  });
  await tsService.replaceTurn({ userId: "u1", sessionId: "s1", anchor: { ts: "ts-assistant" }, newContent: "by ts" });
  assert.deepEqual(tsSaved[0].messages.map((message) => message.content), ["by ts"]);
});

test("SessionMessageService.replaceTurn uses dialogId only as compatibility anchor", async () => {
  const { service, saved } = createService({
    initialSession: baseSession({ messages: [
      { messageId: "m1", role: "user", content: "first", dialogId: "dp-compat" },
      { messageId: "m2", role: "assistant", content: "answer", dialogId: "dp-compat" },
      { messageId: "m3", role: "user", content: "tail", dialogId: "dp-tail" },
    ] }),
  });

  await service.replaceTurn({
    userId: "u1",
    sessionId: "s1",
    anchor: { dialogId: "dp-compat" },
    newContent: "edited compat",
  });

  assert.deepEqual(saved[0].messages.map((message) => message.content), ["edited compat"]);
  assert.notEqual(saved[0].messages[0].turnId, "dp-compat");
  assert.equal(saved[0].messages[0].dialogProcessId, "dp-compat");
});

test("SessionMessageService.replaceTurn rejects conflicts and missing anchors without saving", async () => {
  const { service, saved } = createService({ initialSession: baseSession({ version: 5, revision: 5 }) });

  await assert.rejects(
    service.replaceTurn({ userId: "u1", sessionId: "s1", anchor: { messageId: "m-user" }, newContent: "edit", expectedVersion: 4 }),
    (error) => error?.statusCode === 409 && error?.currentVersion === 5,
  );
  await assert.rejects(
    service.replaceTurn({ userId: "u1", sessionId: "s1", anchor: { messageId: "missing" }, newContent: "edit" }),
    (error) => error?.statusCode === 404 && /anchor not found/.test(error.message),
  );
  assert.equal(saved.length, 0);
});

test("SessionMessageService.replaceTurn validates required payload", async () => {
  const { service, saved } = createService({ initialSession: baseSession() });

  await assert.rejects(
    service.replaceTurn({ userId: "u1", sessionId: "s1", anchor: { messageId: "m-user" }, newContent: " " }),
    (error) => error?.statusCode === 400 && /newContent is required/.test(error.message),
  );
  await assert.rejects(
    service.replaceTurn({ userId: "u1", sessionId: "s1", newContent: "edit" }),
    (error) => error?.statusCode === 400 && /anchor is required/.test(error.message),
  );
  assert.equal(saved.length, 0);
});
