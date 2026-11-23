/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { submitTestSessionRequest } from "./session-services.js";
import assert from "node:assert/strict";
import test from "node:test";

export function registerImmutableTurnIdentityTests({ fixture, message, ts }) {
  test("reused user turn identity reads only the first indexed turn message", async (t) => {
    const { runtime, repository, persistenceContext } = await fixture(t);
    await using before = await repository.requireSessionReader("u1", "s1", { persistenceContext });
    const tail = Array.from({ length: 256 }, (_, index) => {
      const record = message(`tail-${index}`);
      delete record.userMessageId;
      delete record.messageOrigin;
      return {
        ...record,
        role: "assistant",
        modelMessageId: `model-${index}`,
        presentationMessageId: "presentation-t1",
      };
    });
    await submitTestSessionRequest(
      repository,
      "u1",
      "s1",
      await before.prepareRequest({
        operationId: "seed-reuse",
        committedAt: ts,
        changes: { messages: [message("anchor"), ...tail] },
      }),
      persistenceContext,
    );
    const requestedUids = [];
    const openReader = repository.requireSessionReader.bind(repository);
    t.mock.method(repository, "requireSessionReader", async (...args) => {
      const reader = await openReader(...args);
      return {
        ...reader,
        async readFirstTurnMessage(turnScopeId) {
          assert.ok(["t1", "missing"].includes(turnScopeId));
          const message = await reader.readFirstTurnMessage(turnScopeId);
          if (turnScopeId === "missing") assert.equal(message, null);
          else requestedUids.push(message.messageUid);
          return message;
        },
        async readTurnPage() {
          assert.fail("Turn identity must use the bounded first-message read");
        },
      };
    });
    const request = {
      userId: "u1",
      sessionId: "s1",
      persistenceContext,
      turnScopeId: "t1",
      dialogProcessId: "d1",
      attachments: [],
    };
    const result = await runtime.sessionMessageService.assertReusedUserTurnIdentity(request);
    assert.equal(result.userMessage.messageUid, "anchor");
    assert.equal(result.session.messages.length, 1);
    assert.deepEqual(requestedUids, ["anchor"]);
    await assert.rejects(
      runtime.sessionMessageService.assertReusedUserTurnIdentity({
        ...request,
        dialogProcessId: "wrong",
      }),
      /dialogProcessId does not match Session authority/,
    );
    await assert.rejects(
      runtime.sessionMessageService.assertReusedUserTurnIdentity({
        ...request,
        turnScopeId: "missing",
      }),
      /user message was not found/,
    );
    assert.deepEqual(requestedUids, ["anchor", "anchor"]);
  });
}
