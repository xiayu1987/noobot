/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  projectMessagePersistenceChange,
  requireSessionChanges,
  requireMessageMetadataUpdate,
  applyMessageMetadataUpdate,
} from "@noobot/session-protocol/session-changes";

const ownership = { sessionId: "session", dialogProcessId: "dialog", turnScopeId: "turn" };
const message = { ...ownership, messageUid: "message", role: "assistant", content: "before" };
const receipt = {
  ...ownership,
  messageUid: message.messageUid,
  contentReference: "content-reference",
  owner: 1,
  generation: 1,
  activityEventIds: [],
};
const persisted = { message, receipt };

test("acknowledged ownership is checked before every replacement and incremental operation", () => {
  for (const change of [{ content: "replacement" }, { role: "tool" }, { summarized: true }]) {
    for (const field of ["sessionId", "messageUid", "dialogProcessId", "turnScopeId"]) {
      assert.throws(
        () =>
          projectMessagePersistenceChange(
            { ...message, ...change, [field]: "foreign" },
            persisted,
            ownership,
          ),
        /Acknowledged message ownership mismatch/,
      );
      assert.throws(
        () =>
          projectMessagePersistenceChange(
            { ...message, ...change },
            {
              message: { ...message, [field]: "foreign" },
              receipt,
            },
            ownership,
          ),
        /Acknowledged message ownership mismatch/,
      );
    }
    assert.throws(
      () =>
        projectMessagePersistenceChange({ ...message, ...change }, persisted, {
          ...ownership,
          sessionId: "foreign",
        }),
      /Acknowledged message ownership mismatch/,
    );
  }
});

test("an explicit append and metadata update share the acknowledged content version", () => {
  const changes = projectMessagePersistenceChange(
    { ...message, content: "before after", summarized: true },
    persisted,
    ownership,
    " after",
  );
  assert.equal(requireSessionChanges(changes), changes);
  assert.equal(changes.messages, undefined);
  assert.deepEqual(changes.messageContentAppends, [
    {
      messageUid: message.messageUid,
      dialogProcessId: ownership.dialogProcessId,
      turnScopeId: ownership.turnScopeId,
      expectedContentReference: receipt.contentReference,
      owner: receipt.owner,
      content: " after",
    },
  ]);
  assert.deepEqual(changes.messageMetadataUpdates, [
    {
      messageUid: message.messageUid,
      dialogProcessId: ownership.dialogProcessId,
      turnScopeId: ownership.turnScopeId,
      expectedContentReference: receipt.contentReference,
      owner: receipt.owner,
      metadata: { summarized: true },
      metadataRemovals: [],
    },
  ]);
});

test("unchanged acknowledged messages confirm their content version without carrying a body", () => {
  const changes = projectMessagePersistenceChange({ ...message }, persisted, ownership);
  assert.equal(requireSessionChanges(changes), changes);
  assert.deepEqual(changes, {
    messageMetadataUpdates: [
      {
        messageUid: message.messageUid,
        dialogProcessId: ownership.dialogProcessId,
        turnScopeId: ownership.turnScopeId,
        expectedContentReference: receipt.contentReference,
        owner: receipt.owner,
        metadata: {},
        metadataRemovals: [],
      },
    ],
  });
  assert.ok(!JSON.stringify(changes).includes(message.content));
});

test("presentation demotion removes workspace metadata without resubmitting content", () => {
  const previous = { ...message, chatPresentation: true, workspaceRootDirectory: "/workspace" };
  const { workspaceRootDirectory, ...demoted } = previous;
  assert.equal(workspaceRootDirectory, "/workspace");
  demoted.chatPresentation = false;
  const changes = projectMessagePersistenceChange(
    demoted,
    { message: previous, receipt },
    ownership,
  );
  assert.equal(changes.messages, undefined);
  assert.equal(requireSessionChanges(changes), changes);
  assert.deepEqual(changes.messageMetadataUpdates, [
    {
      messageUid: message.messageUid,
      dialogProcessId: ownership.dialogProcessId,
      turnScopeId: ownership.turnScopeId,
      expectedContentReference: receipt.contentReference,
      owner: receipt.owner,
      metadata: { chatPresentation: false },
      metadataRemovals: ["workspaceRootDirectory"],
    },
  ]);
  assert.ok(!JSON.stringify(changes).includes(message.content));
});

test("metadata removals reject ambiguous or foreign fields before applying any change", () => {
  const update = {
    messageUid: message.messageUid,
    dialogProcessId: ownership.dialogProcessId,
    turnScopeId: ownership.turnScopeId,
    expectedContentReference: receipt.contentReference,
    owner: receipt.owner,
    metadata: { chatPresentation: false },
    metadataRemovals: ["workspaceRootDirectory"],
  };
  const original = Object.freeze({
    ...message,
    chatPresentation: true,
    workspaceRootDirectory: "/workspace",
  });
  const applied = applyMessageMetadataUpdate(original, update);
  assert.equal(applied.content, original.content);
  assert.equal(applied.chatPresentation, false);
  assert.equal(Object.hasOwn(applied, "workspaceRootDirectory"), false);
  assert.equal(original.workspaceRootDirectory, "/workspace");
  const { metadataRemovals, ...missingRemovals } = update;
  assert.deepEqual(metadataRemovals, ["workspaceRootDirectory"]);
  for (const invalid of [
    missingRemovals,
    { ...update, metadataRemovals: undefined },
    { ...update, metadataRemovals: "workspaceRootDirectory" },
    { ...update, metadataRemovals: ["workspaceRootDirectory", "workspaceRootDirectory"] },
    { ...update, metadataRemovals: ["content"] },
    { ...update, metadataRemovals: ["messageUid"] },
    { ...update, metadataRemovals: ["chatPresentation"] },
    { ...update, metadata: { chatPresentation: undefined } },
  ]) {
    assert.throws(() => requireMessageMetadataUpdate(invalid), TypeError);
    assert.throws(() => applyMessageMetadataUpdate(original, invalid), TypeError);
    assert.equal(original.chatPresentation, true);
    assert.equal(original.workspaceRootDirectory, "/workspace");
  }
});

test("user message attachment changes require the binding command", () => {
  const user = { ...message, role: "user", attachments: [{ attachmentId: "upload" }] };
  const update = {
    messageUid: user.messageUid,
    dialogProcessId: user.dialogProcessId,
    turnScopeId: user.turnScopeId,
    expectedContentReference: receipt.contentReference,
    owner: receipt.owner,
    metadata: {},
    metadataRemovals: [],
  };
  assert.throws(
    () => applyMessageMetadataUpdate(user, { ...update, metadataRemovals: ["attachments"] }),
    /require the binding command/,
  );
  const change = { ...update, metadata: { attachments: [] } };
  assert.throws(() => applyMessageMetadataUpdate(user, change), /require the binding command/);
  assert.deepEqual(applyMessageMetadataUpdate(message, change).attachments, []);
  assert.throws(
    () =>
      projectMessagePersistenceChange(
        { ...user, attachments: [] },
        { message: user, receipt },
        ownership,
      ),
    /require the binding command/,
  );
  assert.deepEqual(
    projectMessagePersistenceChange(structuredClone(user), { message: user, receipt }, ownership)
      .messageMetadataUpdates[0],
    update,
  );
});

test("full assignments preserve replacement semantics without inferring a prefix append", () => {
  const replacement = { ...message, content: "before after" };
  assert.deepEqual(projectMessagePersistenceChange(replacement, persisted, ownership), {
    messageContentReplacements: [
      {
        messageUid: receipt.messageUid,
        dialogProcessId: receipt.dialogProcessId,
        turnScopeId: receipt.turnScopeId,
        expectedContentReference: receipt.contentReference,
        owner: receipt.owner,
        content: replacement.content,
      },
    ],
  });
  assert.deepEqual(projectMessagePersistenceChange(message, null, ownership), {
    messages: [message],
  });
});

test("persisted identity fields cannot be changed by submitting a creation", () => {
  assert.throws(
    () => projectMessagePersistenceChange({ ...message, role: "tool" }, persisted, ownership),
    /Cannot update persisted message field: role/,
  );
});
