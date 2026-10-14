/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { TRANSFER_REASON } from "@noobot/semantic-transfer-protocol";
import test from "node:test";
import assert from "node:assert/strict";
import {
  applyNormalizedMessageFlags,
  isPlainObject,
  normalizeTrimmedStringList,
  resolvePreferredAttachments,
  resolveTransferEnvelopeListFromMessage,
  resolveTransferEnvelopesFromMessage,
  selectHookManager,
} from "../../src/bot/session/session-execution-engine-utils.js";

test("session-execution-engine-utils normalizes plugin selectors and resolves plugin options", () => {
  assert.deepEqual(normalizeTrimmedStringList([" a ", "", null, "b"]), ["a", "b"]);
});

test("session-execution-engine-utils applies normalized message flags", () => {
  const target = {};
  const applied = applyNormalizedMessageFlags(target, {
    lc_kwargs: {
      injectedMessage: true,
      injectedBy: "botPlugin",
      injectedMessageType: "system",
      additional_kwargs: {
        messageOrigin: "natural",
        userMetaMaterialized: true,
      },
    },
  });

  assert.equal(applied, target);
  assert.equal(applied.injectedMessage, true);
  assert.equal(applied.injectedBy, "botPlugin");
  assert.equal(applied.injectedMessageType, "system");
  assert.equal(applied.messageOrigin, "natural");
  assert.equal(applied.userMetaMaterialized, true);
});

test("session-execution-engine-utils resolves transfer envelopes and preferred attachments", () => {
  const makeEnvelope = (id) => ({
    protocol: "noobot.semantic-transfer",
    version: 2,
    transferId: `transfer-${id}`,
    messageId: `message-${id}`,
    identity: {
      sessionId: "s1",
      turnScopeId: "t1",
      runId: "r1",
      producer: { type: "tool", id: `call-${id}` },
    },
    direction: "output",
    payload: {
      mode: "attachment",
      attachments: [
        {
          identity: { attachmentId: `att-${id}`, sessionId: "s1", attachmentSource: "model" },
          role: "primary",
          name: `${id}.txt`,
          mimeType: "text/plain",
        },
      ],
    },
    intent: {
      source: "tool",
      reason: TRANSFER_REASON.SEMANTIC_TRANSFER_TOOL_RESULT,
      scenario: "tool",
      strategy: "tool_output",
    },
    meta: {},
  });
  const message = {
    transferEnvelopes: [makeEnvelope("1")],
    lc_kwargs: { transferEnvelopes: [makeEnvelope("3")] },
  };

  assert.equal(isPlainObject({}), true);
  assert.equal(isPlainObject([]), false);
  assert.deepEqual(
    resolveTransferEnvelopeListFromMessage(message).map((item) => item.transferId),
    ["transfer-1", "transfer-3"],
  );
  assert.deepEqual(
    resolveTransferEnvelopesFromMessage(message).map((item) => item.transferId),
    ["transfer-1", "transfer-3"],
  );
  assert.deepEqual(
    resolvePreferredAttachments(message).map((item) => item.identity.attachmentId),
    ["att-1", "att-3"],
  );
  assert.deepEqual(resolvePreferredAttachments({ attachments: [{ attachmentId: "fallback" }] }), [
    { attachmentId: "fallback" },
  ]);
  assert.deepEqual(
    resolvePreferredAttachments({ attachmentMetas: [{ attachmentId: "legacy" }] }),
    [],
  );
});

test("session-execution-engine-utils selects only the canonical manager or creates one", () => {
  const manager = { kind: "manager" };
  const hooks = { kind: "hooks", on() {} };
  const created = { kind: "created" };

  assert.equal(
    selectHookManager({
      runConfig: { hookManager: manager, hooks },
      managerKey: "hookManager",
      createManager: () => created,
    }),
    manager,
  );
  assert.equal(
    selectHookManager({
      runConfig: { hooks },
      managerKey: "hookManager",
      createManager: () => created,
    }),
    created,
  );
  assert.equal(
    selectHookManager({
      runConfig: {},
      managerKey: "hookManager",
      createManager: () => created,
    }),
    created,
  );
});
