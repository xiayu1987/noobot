/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import {
  readJsonlArtifactFile,
  readSessionArtifact,
} from "../../src/session/session-artifact-store.js";
import { SESSION_DISPLAY_SUMMARY_SCHEMA_VERSION } from "../../src/session/session-summary-builders.js";
import os from "node:os";
import path from "node:path";

import {
  applyNormalizedMessageFlags,
  isPlainObject,
  normalizeMessageForModelRuntime,
  normalizePluginSelectorSet,
  normalizeTrimmedStringList,
  persistSnapshotJsonFiles,
  resolvePluginOptionsFromConfig,
  resolvePreferredAttachments,
  resolveTransferEnvelopeListFromMessage,
  resolveTransferEnvelopesFromMessage,
  selectHookManager,
} from "../../src/bot/session/session-execution-engine-utils.js";

async function createTempRoot() {
  return fs.mkdtemp(path.join(os.tmpdir(), "noobot-session-engine-utils-"));
}

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
    intent: { source: "tool", reason: "result", scenario: "tool", strategy: "tool_output" },
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

test("session-execution-engine-utils persists snapshot json files", async () => {
  const outputDir = path.join(await createTempRoot(), "snapshot");
  const persisted = await persistSnapshotJsonFiles({
    outputDir,
    sessionPayload: {
      sessionId: "s1",
      parentSessionId: "p1",
      messages: [
        {
          messageUid: "sm_snapshot_assistant",
          role: "assistant",
          content: "canonical attachment",
          dialogProcessId: "dialog-snapshot",
          turnScopeId: "turn-snapshot",
          attachments: [
            {
              attachmentId: "att-1",
              sessionId: "s1",
              attachmentSource: "user",
              name: "a.txt",
              mimeType: "text/plain",
            },
          ],
        },
      ],
    },
    taskPayload: { sessionId: "s1", tasks: [] },
    executionPayload: { sessionId: "s1", logs: [{ event: "started" }] },
    metadata: { node: "n1" },
    now: () => "2026-05-14T00:00:00.000Z",
  });

  assert.equal(persisted.outputDir, outputDir);
  const sessionPayload = JSON.parse(await fs.readFile(persisted.files.session, "utf8"));
  assert.equal(sessionPayload.sessionId, "s1");
  assert.equal(sessionPayload.parentSessionId, "p1");
  assert.equal(sessionPayload.schemaVersion, 6);
  assert.equal(sessionPayload.messageIdentityVersion, 1);
  assert.equal("messages" in sessionPayload, false);
  assert.equal(sessionPayload.turnOrder.length, 1);
  assert.deepEqual(sessionPayload.messageOrder, [{ messageUid: "sm_snapshot_assistant" }]);
  assert.equal(sessionPayload.turnOrder[0].turnId, "turn-000001");
  assert.equal(sessionPayload.turnOrder[0].artifactOrdinal, 1);
  assert.equal(sessionPayload.turnOrder[0].turnScopeId, "turn-snapshot");
  assert.equal(sessionPayload.turnOrder[0].file, "turns/turn-000001.jsonl");
  assert.equal(sessionPayload.turnOrder[0].messageCount, 1);
  assert.equal(typeof sessionPayload.turnOrder[0].committedBytes, "number");
  assert.equal(typeof sessionPayload.turnOrder[0].recordCount, "number");
  assert.deepEqual(sessionPayload.turnOrder[0].messageOrder, ["sm_snapshot_assistant"]);
  assert.equal(typeof sessionPayload.turnOrder[0].messageHashes.sm_snapshot_assistant, "string");
  assert.match(sessionPayload.turnOrder[0].messageHashes.sm_snapshot_assistant, /^sha256:/);
  assert.equal(sessionPayload.turnOrder[0].compacted, false);
  assert.equal(sessionPayload.createdAt, "2026-05-14T00:00:00.000Z");
  assert.equal(sessionPayload.updatedAt, "2026-05-14T00:00:00.000Z");
  assert.equal(JSON.stringify(sessionPayload).includes("attachmentMetas"), false);
  const aggregatedSession = await readSessionArtifact({ sessionDir: persisted.outputDir });
  assert.equal("id" in aggregatedSession.messages[0].attachments[0], false);
  const sessionSummary = JSON.parse(await fs.readFile(persisted.files.sessionSummary, "utf8"));
  assert.equal(sessionSummary.schemaVersion, SESSION_DISPLAY_SUMMARY_SCHEMA_VERSION);
  assert.equal(sessionSummary.sessionId, "s1");
  assert.equal(sessionSummary.parentSessionId, "p1");
  assert.equal(sessionSummary.stats.messageCount, 1);
  assert.equal(sessionSummary.messages[0].attachments[0].attachmentId, "att-1");
  assert.equal(JSON.stringify(sessionSummary).includes("attachmentMetas"), false);
  assert.deepEqual(JSON.parse(await fs.readFile(persisted.files.task, "utf8")), {
    sessionId: "s1",
    tasks: [],
  });
  assert.deepEqual(JSON.parse(await fs.readFile(persisted.files.execution, "utf8")), {
    sessionId: "s1",
    logs: [{ event: "started" }],
  });
  assert.deepEqual(await readJsonlArtifactFile(persisted.files.executionEvents), [
    { event: "started" },
  ]);
  assert.deepEqual(JSON.parse(await fs.readFile(persisted.files.meta, "utf8")), {
    node: "n1",
  });
});
