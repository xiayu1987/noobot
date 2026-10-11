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
  normalizeMessageForModelRuntime,
  normalizePluginSelectorSet,
  normalizeTrimmedStringList,
  resolvePluginOptionsFromConfig,
  resolvePreferredAttachments,
  resolveTransferEnvelopeListFromMessage,
  resolveTransferEnvelopesFromMessage,
  selectHookManager,
} from "../../src/bot/session/session-execution-engine-utils.js";

test("session-execution-engine-utils normalizes plugin selectors and resolves plugin options", () => {
  const selectors = normalizePluginSelectorSet([" agentPlugin ", "", "agentPlugin", "plugin-key"]);

  assert.deepEqual(Array.from(selectors), ["agentPlugin", "plugin-key"]);
  assert.deepEqual(normalizeTrimmedStringList([" a ", "", null, "b"]), ["a", "b"]);
  assert.deepEqual(
    resolvePluginOptionsFromConfig(
      {
        plugins: {
          agentPlugin: { enabled: true, mode: "off", fromPlugin: true },
          "plugin-key": { mode: "on", fromKey: true },
          other: { ignored: true },
        },
      },
      selectors,
    ),
    {
      enabled: true,
      mode: "on",
      fromPlugin: true,
      fromKey: true,
    },
  );
});

test("session-execution-engine-utils normalizes plugin messages from plain and lc_kwargs shapes", () => {
  const normalized = normalizeMessageForModelRuntime({
    lc_kwargs: {
      content: "tool result",
      tool_call_id: "tc1",
      additional_kwargs: {
        noobotInternalMessageType: "internal",
      },
    },
    role: "tool",
    additional_kwargs: { summarized: true, noobotMessageId: "am_runtime" },
    injectedMessage: true,
    injectedBy: "agentPlugin",
    injectedMessageType: "planning",
    messageOrigin: "natural",
    userMetaMaterialized: true,
    dialogProcessId: "d1",
    turnScopeId: "t1",
  });

  assert.equal(normalized.role, "tool");
  assert.equal(typeof normalized.content, "string");
  assert.equal(normalized.tool_call_id, "tc1");
  assert.equal(normalized.summarized, true);
  assert.equal(normalized.additional_kwargs.noobotInternalMessageType, "internal");
  assert.equal(normalized.injectedMessage, true);
  assert.equal(normalized.injectedBy, "agentPlugin");
  assert.equal(normalized.injectedMessageType, "planning");
  assert.equal(normalized.messageOrigin, "natural");
  assert.equal(normalized.userMetaMaterialized, true);
  assert.equal(normalized.dialogProcessId, "d1");
  assert.equal(normalized.turnScopeId, "t1");
  assert.equal(normalized.additional_kwargs.noobotMessageId, "am_runtime");
  assert.equal(normalizeMessageForModelRuntime({ content: "no-role" }), null);
});

test("session-execution-engine-utils preserves restored canonical injection metadata", () => {
  const normalized = normalizeMessageForModelRuntime({
    role: "user",
    content: "restored guidance",
    additional_kwargs: {
      noobotMessageId: "sm_restored_guidance",
      injectedMessage: true,
      injectedBy: "harness-plugin",
      injectedMessageType: "separate_model_relay:guidance",
    },
  });

  assert.equal(normalized.injectedMessage, true);
  assert.equal(normalized.injectedBy, "harness-plugin");
  assert.equal(normalized.injectedMessageType, "separate_model_relay:guidance");
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
