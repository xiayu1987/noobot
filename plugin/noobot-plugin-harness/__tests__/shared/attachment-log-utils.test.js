/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  applyTransferPayloadToMessage,
  consumeDeferredCapabilityLogs,
  deferCapabilityLogs,
  saveCapabilityOutputAsTransferArtifacts,
} from "../../src/capabilities/handlers/shared/attachment-log-utils.js";
import { attachmentTransfer, TRANSFER_REASON } from "@noobot/semantic-transfer-protocol";
import { containsExecutableScriptText } from "../../src/capabilities/handlers/shared/script-content-risk.js";

test("containsExecutableScriptText recognizes executable script signals only", () => {
  assert.equal(containsExecutableScriptText("```bash\nrm -rf /tmp/demo\n```"), true);
  assert.equal(containsExecutableScriptText("说明代码函数 foo() 的用途"), false);
});

test("transfer payload binds and deduplicates complete V2 envelopes by stable transfer identity", () => {
  const envelope = attachmentTransfer({
    transferId: "transfer-1",
    presentationMessageId: "message-1",
    identity: {
      sessionId: "session-1",
      turnScopeId: "turn-1",
      runId: "run-1",
      producer: { type: "plugin", id: "harness" },
    },
    direction: "output",
    attachments: [
      {
        identity: {
          attachmentId: "attachment-1",
          sessionId: "session-1",
          attachmentSource: "model",
        },
        role: "primary",
        name: "report.txt",
        mimeType: "text/plain",
        size: 12,
      },
    ],
    intent: {
      source: "plugin",
      reason: TRANSFER_REASON.HARNESS_SUMMARY,
      scenario: "harness",
      strategy: "harness_summary",
    },
  });
  const message = applyTransferPayloadToMessage(
    { role: "assistant", transferEnvelopes: [envelope] },
    { transferEnvelopes: [{ ...envelope }] },
  );
  assert.equal(message.transferEnvelopes.length, 1);
  assert.equal(
    message.transferEnvelopes[0].payload.attachments[0].identity.attachmentId,
    "attachment-1",
  );
  assert.equal(message.attachments, undefined);
});

test("deferred capability log outbox is consumed exactly once by the next hook context", () => {
  const agentContext = {};
  const toolContext = { agentContext };
  const acceptanceLog = { domain: "acceptance", event: "acceptance_semantic_validation_completed" };

  assert.equal(deferCapabilityLogs(toolContext, [acceptanceLog]), 1);
  const afterToolHookContext = { agentContext };
  assert.equal(consumeDeferredCapabilityLogs(afterToolHookContext), 1);
  assert.deepEqual(afterToolHookContext.harnessCapabilityLogs, [acceptanceLog]);
  assert.equal(consumeDeferredCapabilityLogs({ agentContext }), 0);
});

test("each capability artifact operation owns a distinct semantic transfer identity", async () => {
  const transferKeys = [];
  const ctx = {
    agentContext: {
      bindings: {
        runtime: {
          sharedTools: {
            semanticTransfer: {
              async transferSemanticContent(payload) {
                transferKeys.push(payload.transferKey);
                return { transferEnvelopes: [] };
              },
            },
          },
        },
      },
    },
  };

  await saveCapabilityOutputAsTransferArtifacts(ctx, {
    purpose: "planning_refinement",
    content: "first",
    domain: "planning",
  });
  await saveCapabilityOutputAsTransferArtifacts(ctx, {
    purpose: "planning_refinement",
    content: "second",
    domain: "planning",
  });

  assert.equal(transferKeys.length, 2);
  assert.ok(transferKeys.every(Boolean));
  assert.notEqual(transferKeys[0], transferKeys[1]);
});

test("latest harness injected message receives envelopes in context metadata and session record", async () => {
  const { attachTransferPayloadToLatestInjectedMessage } =
    await import("../../src/capabilities/handlers/shared/attachment-log-utils.js");
  const { buildHarnessInjectedRecord } =
    await import("../../src/capabilities/handlers/shared/message/injected-message-utils.js");
  const { projectSessionRecordToContextMessage } =
    await import("@noobot/context-protocol/message/session-projection");
  const { readContextMessageValue } = await import("@noobot/context-protocol/message/codec");
  const { replaceMessages } = await import("../../src/core/message-store.js");
  const { createTestHookContext } = await import("../helpers/public-runtime-fixtures.js");

  const record = buildHarnessInjectedRecord("relay", {
    role: "user",
    dialogProcessId: "dp-1",
    injectedMessageType: "harness_relay",
  });
  const ctx = createTestHookContext({ agentContext: { bindings: { runtime: {} } } });
  ctx.modelContext.activeTurnIdentity = { dialogProcessId: "dp-1", turnScopeId: "turn-1" };
  replaceMessages(ctx, [projectSessionRecordToContextMessage(record)]);
  const sessionRecords = [{ ...record }];
  ctx.agentContext.bindings.runtime.currentTurnMessages = {
    push(value) {
      sessionRecords.push(value);
    },
    updateLast(patch, matcher) {
      for (let index = sessionRecords.length - 1; index >= 0; index -= 1) {
        if (!matcher(sessionRecords[index])) continue;
        sessionRecords[index] = { ...sessionRecords[index], ...patch };
        return sessionRecords[index];
      }
      return null;
    },
  };
  const envelope = attachmentTransfer({
    transferId: "transfer-sync",
    presentationMessageId: "msg_sync",
    identity: {
      sessionId: "session-1",
      turnScopeId: "turn-1",
      runId: "run-1",
      producer: { type: "plugin", id: "harness" },
    },
    direction: "output",
    attachments: [
      {
        identity: {
          attachmentId: "attachment-sync",
          sessionId: "session-1",
          attachmentSource: "model",
        },
        role: "primary",
        name: "report.txt",
        mimeType: "text/plain",
        size: 12,
      },
    ],
    intent: {
      source: "plugin",
      reason: TRANSFER_REASON.HARNESS_SUMMARY,
      scenario: "harness",
      strategy: "harness_summary",
    },
  });

  assert.equal(
    attachTransferPayloadToLatestInjectedMessage(ctx, { transferEnvelopes: [envelope] }),
    true,
  );
  const contextMessage = ctx.modelContext.messages.at(-1);

  assert.equal(Object.hasOwn(contextMessage, "transferEnvelopes"), false);
  assert.equal(readContextMessageValue(contextMessage, "transferEnvelopes").length, 1);

  assert.equal(sessionRecords.at(-1).transferEnvelopes.length, 1);
});
