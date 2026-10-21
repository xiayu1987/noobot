/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import { createModelContext } from "@noobot/context-protocol";
import { projectSessionRecordToContextMessage } from "@noobot/context-protocol/message/session-projection";
import { createMessageUid } from "@noobot/session-protocol/message-identity";
import {
  readContextMessageValue,
  resolveContextMessageId,
} from "@noobot/context-protocol/message/codec";

import { ModelMessageRuntimeHelpers } from "../../src/bot/session/model-message-runtime-helpers.js";

function sessionContextMessage(record) {
  return projectSessionRecordToContextMessage({ messageUid: createMessageUid(), ...record });
}

const agentContext = { bindings: { runtime: { eventListener: { onEvent() {} } }, tools: [] } };

test("ModelMessageRuntimeHelpers resolveModelMessages uses main-flow blocks", () => {
  const helpers = new ModelMessageRuntimeHelpers();
  const resolver = helpers.createResolveModelMessages();

  const resolved = resolver({
    ctx: {
      agentContext,
      modelContext: createModelContext({
        messageBlocks: {
          system: [sessionContextMessage({ role: "system", content: "sys" })],
          history: [
            sessionContextMessage({ role: "user", content: "old-u", dialogProcessId: "d1" }),
            sessionContextMessage({ role: "assistant", content: "old-a", dialogProcessId: "d1" }),
            sessionContextMessage({ role: "user", content: "new-u", dialogProcessId: "d2" }),
            sessionContextMessage({ role: "assistant", content: "new-a", dialogProcessId: "d2" }),
          ],
          incremental: [
            sessionContextMessage({ role: "user", content: "inc-u", dialogProcessId: "d3" }),
            sessionContextMessage({
              role: "assistant",
              content: "drop",
              summarized: true,
              dialogProcessId: "d3",
            }),
            sessionContextMessage({ role: "assistant", content: "inc-a", dialogProcessId: "d3" }),
          ],
        },
      }),
    },
  });

  assert.deepEqual(
    resolved.map((item = {}) => item.content),
    ["sys", "old-u", "old-a", "new-u", "new-a", "inc-u", "inc-a"],
  );
});

test("ModelMessageRuntimeHelpers preserves canonical identity across normalized projections", () => {
  const helpers = new ModelMessageRuntimeHelpers();
  const resolver = helpers.createResolveModelMessages();
  const modelContext = createModelContext({
    messageBlocks: {
      system: [],
      history: [
        sessionContextMessage({
          role: "user",
          content: "history",
          dialogProcessId: "d1",
          turnScopeId: "t1",
        }),
      ],
      incremental: [
        sessionContextMessage({
          role: "user",
          content: "current",
          dialogProcessId: "d2",
          turnScopeId: "t2",
        }),
      ],
    },
  });
  const sourceIds = modelContext.messages.map(resolveContextMessageId);

  const resolved = resolver({ ctx: { agentContext, modelContext } });

  assert.equal(resolved[0], modelContext.messageBlocks.history[0]);
  assert.equal(resolved[1], modelContext.messageBlocks.incremental[0]);
  assert.deepEqual(resolved.map(resolveContextMessageId), sourceIds);
  assert.deepEqual(
    resolved.map((message) => readContextMessageValue(message, "turnScopeId")),
    ["t1", "t2"],
  );
});

test("ModelMessageRuntimeHelpers resolves non-main history from authoritative modelContext", () => {
  const helpers = new ModelMessageRuntimeHelpers();
  const resolver = helpers.createResolveModelMessages();

  const resolved = resolver({
    purpose: "planning",
    ctx: {
      agentContext,
      modelContext: createModelContext({
        messageBlocks: {
          system: [sessionContextMessage({ role: "system", content: "sys" })],
          history: [
            sessionContextMessage({ role: "user", content: "hist-u", dialogProcessId: "d1" }),
            sessionContextMessage({ role: "assistant", content: "hist-a", dialogProcessId: "d1" }),
          ],
          incremental: [
            sessionContextMessage({ role: "user", content: "inc-u", dialogProcessId: "d2" }),
          ],
        },
      }),
    },
  });

  assert.deepEqual(
    resolved.map((item = {}) => item.content),
    ["sys", "hist-u", "hist-a", "inc-u"],
  );
});

test("ModelMessageRuntimeHelpers does not clip authoritative non-main blocks", () => {
  const helpers = new ModelMessageRuntimeHelpers();
  const resolver = helpers.createResolveModelMessages();

  const history = Array.from({ length: 22 }, (_, index) =>
    sessionContextMessage({
      role: index % 2 === 0 ? "user" : "assistant",
      content: `history-${index + 1}`,
      dialogProcessId: "dlg-history",
    }),
  );
  const incremental = Array.from({ length: 4 }, (_, index) =>
    sessionContextMessage({
      role: index % 2 === 0 ? "user" : "assistant",
      content: `incremental-${index + 1}`,
      dialogProcessId: "dlg-current",
    }),
  );

  const resolved = resolver({
    purpose: "planning",
    ctx: {
      agentContext,
      modelContext: createModelContext({
        messageBlocks: {
          system: [sessionContextMessage({ role: "system", content: "sys" })],
          history,
          incremental,
        },
      }),
    },
  });

  assert.deepEqual(
    resolved.map((item = {}) => item.content),
    ["sys", ...history.map((item) => item.content), ...incremental.map((item) => item.content)],
  );
});

test("ModelMessageRuntimeHelpers does not clip non-main model context by default", () => {
  const helpers = new ModelMessageRuntimeHelpers();
  const resolver = helpers.createResolveModelMessages();

  const resolved = resolver({
    ctx: {
      agentContext,
      modelContext: createModelContext({
        messageBlocks: {
          system: [],
          history: [],
          incremental: Array.from({ length: 22 }, (_, index) =>
            sessionContextMessage({
              role: "user",
              content: `m${index + 1}`,
              dialogProcessId: "dlg-1",
            }),
          ),
        },
      }),
    },
  });

  assert.deepEqual(
    resolved.map((item = {}) => item.content),
    Array.from({ length: 22 }, (_, index) => `m${index + 1}`),
  );
});

test("ModelMessageRuntimeHelpers never clips non-main model context in injected resolver", () => {
  const helpers = new ModelMessageRuntimeHelpers();
  const resolver = helpers.createResolveModelMessages();

  const resolved = resolver({
    ctx: {
      agentContext,
      modelContext: createModelContext({
        messageBlocks: {
          system: [],
          history: [],
          incremental: Array.from({ length: 22 }, (_, index) =>
            sessionContextMessage({
              role: "user",
              content: `m${index + 1}`,
              dialogProcessId: "dlg-1",
            }),
          ),
        },
      }),
    },
  });

  assert.deepEqual(
    resolved.map((item = {}) => item.content),
    Array.from({ length: 22 }, (_, index) => `m${index + 1}`),
  );
});

test("ModelMessageRuntimeHelpers keeps unsummarized incremental injections append-only", () => {
  const helpers = new ModelMessageRuntimeHelpers();
  const resolver = helpers.createResolveModelMessages();

  const resolved = resolver({
    ctx: {
      agentContext,
      modelContext: createModelContext({
        messageBlocks: {
          system: [],
          history: [],
          incremental: [
            sessionContextMessage({
              role: "user",
              content: "old-injected",
              injectedMessage: true,
              injectedBy: "agentPlugin",
              injectedMessageType: "agent_plugin",
              dialogProcessId: "old",
            }),
            sessionContextMessage({
              role: "user",
              content: "new-injected",
              injectedMessage: true,
              injectedBy: "agentPlugin",
              injectedMessageType: "agent_plugin",
              dialogProcessId: "new",
            }),
            sessionContextMessage({ role: "assistant", content: "normal", dialogProcessId: "new" }),
          ],
        },
      }),
    },
  });

  assert.deepEqual(
    resolved.map((item = {}) => item.content),
    ["old-injected", "new-injected", "normal"],
  );
});
