import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  applyNormalizedMessageFlags,
  isPlainObject,
  normalizeMessageForModelRuntime,
  normalizePluginSelectorSet,
  normalizeTrimmedStringList,
  persistSnapshotJsonFiles,
  resolveScopedMessagesDialogProcessId,
  resolvePluginOptionsFromConfig,
  resolvePreferredAttachments,
  resolveTransferEnvelopeListFromMessage,
  resolveTransferEnvelopesFromMessage,
  selectHookManager,
} from "../../../src/system-core/bot-manage/session/session-execution-engine-utils.js";

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
    additional_kwargs: { summarized: true },
    injectedMessage: true,
    injectedBy: "agentPlugin",
    injectedMessageType: "planning",
    frontendUserMessage: true,
    dialogProcessId: "d1",
  });

  assert.equal(normalized.role, "tool");
  assert.equal(typeof normalized.content, "string");
  assert.equal(normalized.tool_call_id, "tc1");
  assert.equal(normalized.summarized, true);
  assert.equal(normalized.additional_kwargs.noobotInternalMessageType, "internal");
  assert.equal(normalized.injectedMessage, true);
  assert.equal(normalized.injectedBy, "agentPlugin");
  assert.equal(normalized.injectedMessageType, "planning");
  assert.equal(normalized.frontendUserMessage, true);
  assert.equal(normalized.dialogProcessId, "d1");
  assert.equal(normalizeMessageForModelRuntime({ content: "no-role" }), null);
});

test("session-execution-engine-utils applies normalized message flags", () => {
  const target = {};
  const applied = applyNormalizedMessageFlags(target, {
    lc_kwargs: {
      injectedMessage: true,
      injectedBy: "botPlugin",
      injectedMessageType: "system",
      additional_kwargs: {
        frontendUserMessage: true,
      },
    },
  });

  assert.equal(applied, target);
  assert.equal(applied.injectedMessage, true);
  assert.equal(applied.injectedBy, "botPlugin");
  assert.equal(applied.injectedMessageType, "system");
  assert.equal(applied.frontendUserMessage, true);
});

test("session-execution-engine-utils resolves transfer envelopes and preferred attachments", () => {
  const message = {
    attachments: [{ attachmentId: "fallback" }],
    transferEnvelopes: [
      {
        protocol: "noobot.semantic-transfer",
        version: 1,
        direction: "output",
        transport: "file",
        envelopeId: "e1",
        files: [{ attachmentId: "att-1" }],
      },
    ],
    lc_kwargs: {
      transferEnvelopes: [
        {
          protocol: "noobot.semantic-transfer",
          version: 1,
          direction: "output",
          transport: "file",
          envelopeId: "e3",
          files: [{ attachmentId: "att-3" }],
        },
      ],
    },
  };

  assert.equal(isPlainObject({}), true);
  assert.equal(isPlainObject([]), false);
  assert.deepEqual(resolveTransferEnvelopeListFromMessage(message).map((item) => item.envelopeId), ["e1", "e3"]);
  assert.deepEqual(resolveTransferEnvelopesFromMessage(message).map((item) => item.envelopeId), [
    "e1",
    "e3",
  ]);
  assert.deepEqual(
    resolvePreferredAttachments(message).map((item) => item.attachmentId),
    ["att-1", "att-3"],
  );
  assert.deepEqual(resolvePreferredAttachments({ attachments: [{ attachmentId: "fallback" }] }), [
    { attachmentId: "fallback" },
  ]);
  assert.deepEqual(resolvePreferredAttachments({ attachmentMetas: [{ attachmentId: "legacy" }] }), []);
});

test("session-execution-engine-utils resolves current dialog for incremental blocks", () => {
  const resolvedFromFrontend = resolveScopedMessagesDialogProcessId({
    scope: "incremental",
    ctx: {
      agentContext: {
        execution: {
          dialogProcessId: "ctx-dialog",
        },
      },
    },
    messages: [
      { role: "user", content: "old", frontendUserMessage: true, dialogProcessId: "old-dialog" },
      { role: "user", content: "new", frontendUserMessage: true, dialogProcessId: "new-dialog" },
    ],
  });
  const resolvedFromCtx = resolveScopedMessagesDialogProcessId({
    scope: "history",
    ctx: {
      agentContext: {
        execution: {
          dialogProcessId: "ctx-dialog",
        },
      },
    },
    messages: [],
  });

  assert.equal(resolvedFromFrontend, "new-dialog");
  assert.equal(resolvedFromCtx, "ctx-dialog");
});

test("session-execution-engine-utils selects hook manager with priority and factory fallback", () => {
  const manager = { kind: "manager" };
  const hooks = { kind: "hooks", on() {} };
  const created = { kind: "created" };

  assert.equal(
    selectHookManager({
      runConfig: { hookManager: manager, hooks },
      managerKey: "hookManager",
      hooksKey: "hooks",
      createManager: () => created,
    }),
    manager,
  );
  assert.equal(
    selectHookManager({
      runConfig: { hooks },
      managerKey: "hookManager",
      hooksKey: "hooks",
      createManager: () => created,
    }),
    hooks,
  );
  assert.equal(
    selectHookManager({
      runConfig: {},
      managerKey: "hookManager",
      hooksKey: "hooks",
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
          role: "assistant",
          content: "canonical attachment",
          attachments: [{ attachmentId: "att-1", name: "a.txt" }],
          attachmentMetas: [{ attachmentId: "legacy" }],
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
  assert.deepEqual(sessionPayload, {
    sessionId: "s1",
    parentSessionId: "p1",
    caller: "user",
    modelAlias: "",
    currentTaskId: "",
    shortMemoryCheckpoint: 0,
    turnTimings: [],
    messages: [
      {
        role: "assistant",
        content: "canonical attachment",
        type: "",
        dialogProcessId: "",
        parentDialogProcessId: "",
        turnScopeId: "",
        taskId: "",
        taskStatus: "",
        modelAlias: "",
        modelName: "",
        summarized: false,
        ts: "2026-05-14T00:00:00.000Z",
        attachments: [{ attachmentId: "att-1", name: "a.txt" }],
      },
    ],
    selectedConnectors: {},
    createdAt: "2026-05-14T00:00:00.000Z",
    updatedAt: "2026-05-14T00:00:00.000Z",
  });
  assert.equal(JSON.stringify(sessionPayload).includes("attachmentMetas"), false);
  assert.equal("id" in sessionPayload.messages[0].attachments[0], false);
  const sessionSummary = JSON.parse(await fs.readFile(persisted.files.sessionSummary, "utf8"));
  assert.equal(sessionSummary.schemaVersion, 5);
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
  assert.equal(await fs.readFile(persisted.files.executionEvents, "utf8"), "{\"event\":\"started\"}\n");
  assert.deepEqual(JSON.parse(await fs.readFile(persisted.files.meta, "utf8")), {
    node: "n1",
  });
});
