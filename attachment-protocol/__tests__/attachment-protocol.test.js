/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  ATTACHMENT_EVENT_TYPE,
  ATTACHMENT_LIFECYCLE,
  attachmentIdentityKey,
  createAttachmentLifecycleEvent,
  createAttachmentSetUpdate,
  parseAttachmentAccessRef,
  parseAttachmentDescriptor,
  parseAttachmentIdentity,
  projectAttachmentIdentity,
  parseAttachmentUiView,
  parsePersistedAttachmentRecord,
  parseRuntimeAttachmentRef,
} from "../src/index.js";

const identity = {
  attachmentId: "att-1",
  sessionId: "session-1",
  attachmentSource: "upload",
};

function descriptor() {
  return {
    identity,
    name: "report.pdf",
    mimeType: "application/pdf",
    size: 42,
    owner: { type: "plugin", id: "plugin-1" },
  };
}

test("canonical identity is exactly the stable triple", () => {
  assert.deepEqual(parseAttachmentIdentity(identity), identity);
  assert.equal(attachmentIdentityKey(identity), attachmentIdentityKey({ ...identity }));
  assert.throws(
    () => parseAttachmentIdentity({ ...identity, path: "/tmp/report.pdf" }),
    /unknown_attachment_identity_field:path/,
  );
  assert.throws(
    () => parseAttachmentIdentity({ attachmentId: "att-1", sessionId: "session-1" }),
    /invalid_attachment_source/,
  );
});

test("metadata identity projection has one strict three-field source", () => {
  assert.deepEqual(
    projectAttachmentIdentity({
      ...identity,
      id: "legacy-id",
      name: "report.pdf",
      path: "/tmp/report.pdf",
    }),
    identity,
  );
  for (const metadata of [
    { id: "att-1", sessionId: "session-1", attachmentSource: "upload" },
    { attachmentId: "att-1", attachmentSource: "upload", path: "/tmp/report.pdf" },
    { attachmentId: "att-1", sessionId: "session-1", name: "report.pdf" },
  ]) {
    assert.throws(() => projectAttachmentIdentity(metadata), /invalid_attachment_/);
  }
  assert.notEqual(
    attachmentIdentityKey(projectAttachmentIdentity(identity)),
    attachmentIdentityKey(projectAttachmentIdentity({ ...identity, sessionId: "session-2" })),
  );
  assert.notEqual(
    attachmentIdentityKey(projectAttachmentIdentity(identity)),
    attachmentIdentityKey(projectAttachmentIdentity({ ...identity, attachmentSource: "model" })),
  );
});

test("descriptor is metadata and cannot smuggle path access fields", () => {
  assert.deepEqual(parseAttachmentDescriptor(descriptor()).identity, identity);
  assert.throws(
    () => parseAttachmentDescriptor({ ...descriptor(), path: "/tmp/report.pdf" }),
    /unknown_attachment_descriptor_field:path/,
  );
});

test("persistence, runtime, access and UI models stay separate", () => {
  const record = parsePersistedAttachmentRecord({
    identity,
    descriptor: descriptor(),
    storageRef: { kind: "attachment-store", ref: "scope/att-1" },
    createdAt: "2026-08-07T00:00:00.000Z",
    updatedAt: "2026-08-07T00:00:00.000Z",
  });
  assert.equal(record.storageRef.ref, "scope/att-1");
  assert.equal(record.descriptor.owner.type, "plugin");
  assert.deepEqual(
    parseRuntimeAttachmentRef({ identity, turnScopeId: "turn-1", runId: "run-1" }).identity,
    identity,
  );
  assert.equal(
    parseAttachmentAccessRef({ identity, capability: "download", href: "/attachments/att-1" })
      .capability,
    "download",
  );
  assert.equal(
    parseAttachmentUiView({ identity, name: "report.pdf", mimeType: "application/pdf" }).name,
    "report.pdf",
  );
  assert.throws(
    () =>
      parsePersistedAttachmentRecord({
        identity,
        descriptor: { ...descriptor(), identity: { ...identity, attachmentId: "att-2" } },
        storageRef: { kind: "attachment-store", ref: "scope/att-1" },
        createdAt: "now",
        updatedAt: "now",
      }),
    /persisted_attachment_identity_mismatch/,
  );
});

test("lifecycle events require stable identity and versioned message identity", () => {
  const event = createAttachmentLifecycleEvent({
    eventType: ATTACHMENT_EVENT_TYPE.PARSED,
    eventVersion: 1,
    messageId: "attachment-event-1",
    identity,
    status: ATTACHMENT_LIFECYCLE.PARSED,
    occurredAt: "2026-08-07T00:00:00.000Z",
  });
  assert.equal(event.identity.attachmentId, "att-1");
  assert.throws(
    () => createAttachmentLifecycleEvent({ ...event, eventVersion: 2 }),
    /unsupported_attachment_event_version/,
  );
  assert.throws(
    () => createAttachmentLifecycleEvent({ ...event, identity: { ...identity, sessionId: "" } }),
    /invalid_attachment_session_id/,
  );
});

test("attachment set update distinguishes unchanged from explicit delete-all", () => {
  assert.deepEqual(createAttachmentSetUpdate(), { kind: "unchanged" });
  assert.deepEqual(createAttachmentSetUpdate([]), { kind: "replace", identities: [] });
  assert.throws(
    () => createAttachmentSetUpdate([identity, identity]),
    /duplicate_attachment_identity/,
  );
  assert.throws(() => createAttachmentSetUpdate({}), /attachments_must_be_array_or_undefined/);
});
