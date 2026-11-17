/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import { createContextScope, projectContextSource, readContextWindowSource } from "../src/index.js";
import {
  createEmptyTurnLifecycle,
  TURN_TERMINAL_FIXED_DESCRIPTION,
} from "@noobot/session-protocol";

function fixture() {
  const turnOrder = Array.from({ length: 12 }, (_, index) => ({
    turnScopeId: `t-${index}`,
    dialogProcessId: `d-${index}`,
  }));
  const messages = turnOrder.map((item, index) => ({
    ...item,
    messageUid: `m-${index}`,
    role: "user",
    messageOrigin: "natural",
    content: `message ${index}`,
    summarized: index === 9,
  }));
  const turnLifecycle = createEmptyTurnLifecycle();
  return { turnOrder, messages, turnLifecycle };
}

test("window source equals full projection and reads only eligible recent groups", async () => {
  const { turnOrder, messages, turnLifecycle } = fixture();
  const scope = createContextScope(turnOrder.at(-1));
  const reads = [];
  const source = await readContextWindowSource({
    turnOrder,
    turnLifecycle,
    scope,
    historyLimit: 3,
    async readTurnMessages(items) {
      reads.push(...items.map((item) => item.turnScopeId));
      return messages.filter((message) =>
        items.some((item) => item.turnScopeId === message.turnScopeId),
      );
    },
  });
  assert.deepEqual(
    projectContextSource({ source, scope, historyLimit: 3 }),
    projectContextSource({ source: { messages, turnLifecycle }, scope, historyLimit: 3 }),
  );
  assert.deepEqual(reads, ["t-10", "t-9", "t-8", "t-7"]);
});

test("terminal projections participate even when all their source messages are summarized", async () => {
  const { turnOrder, messages, turnLifecycle } = fixture();
  const stopped = turnOrder[9];
  const terminalStatus = {
    ...stopped,
    status: "user_stopped",
    reason: "user_stop",
    description: TURN_TERMINAL_FIXED_DESCRIPTION.user_stopped,
  };
  turnLifecycle.turns[stopped.turnScopeId] = {
    ...stopped,
    state: "stop_completed",
    terminalStatus,
  };
  const scope = createContextScope(turnOrder.at(-1));
  const source = await readContextWindowSource({
    turnOrder,
    turnLifecycle,
    scope,
    historyLimit: 2,
    async readTurnMessages(items) {
      return messages.filter((message) =>
        items.some((item) => item.turnScopeId === message.turnScopeId),
      );
    },
  });
  assert.deepEqual(
    projectContextSource({ source, scope, historyLimit: 2 }),
    projectContextSource({ source: { messages, turnLifecycle }, scope, historyLimit: 2 }),
  );
  await assert.rejects(
    readContextWindowSource({
      turnOrder: [stopped],
      turnLifecycle,
      scope,
      historyLimit: 2,
      async readTurnMessages() {
        return [];
      },
    }),
    /missing canonical messages/,
  );
});

test("window reads an entire dialog group across multiple scopes", async () => {
  const { turnOrder, messages, turnLifecycle } = fixture();
  turnOrder[8].dialogProcessId = turnOrder[10].dialogProcessId;
  messages[8].dialogProcessId = messages[10].dialogProcessId;
  const scope = createContextScope(turnOrder.at(-1));
  const source = await readContextWindowSource({
    turnOrder,
    turnLifecycle,
    scope,
    historyLimit: 2,
    async readTurnMessages(items) {
      return messages.filter((message) =>
        items.some((item) => item.turnScopeId === message.turnScopeId),
      );
    },
  });
  assert.deepEqual(
    projectContextSource({ source, scope, historyLimit: 2 }),
    projectContextSource({ source: { messages, turnLifecycle }, scope, historyLimit: 2 }),
  );
});
