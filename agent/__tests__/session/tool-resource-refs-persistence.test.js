/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import { createResourceRef, projectResourceRef } from "@noobot/path-resolver";
import { assertMutationRef } from "@noobot/file-mutation-protocol";

import { normalizeMessageEntity } from "../../src/session/entities.js";
import { buildToolArtifactTimelineProjection } from "../../src/session/session-summary-builders/turn-artifact-projection.js";
import { attachSessionToolArtifacts } from "../../src/session/session-summary-builders/display-tool-artifacts.js";
import { TEST_MESSAGE_TS } from "../helpers/session-run-payload.js";

const SESSION_ID = "s_resource_refs";
const TURN_SCOPE_ID = "client-turn:resource-refs";
const DIALOG_PROCESS_ID = "dp_resource_refs";

function workspaceResource() {
  return createResourceRef({
    owner: "admin",
    source: "workspace",
    logical: { view: "workspace", path: "reports/调查表.xlsx" },
    mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    capabilities: { read: true, write: true },
  });
}

function toolResultMessage(extra = {}) {
  return {
    attachments: [],
    sessionId: SESSION_ID,
    messageUid: "sm_resource_refs_tool",
    ts: TEST_MESSAGE_TS,
    role: "tool",
    type: "tool_result",
    presentationMessageId: "pm_resource_refs",
    tool_call_id: "call_write_1",
    toolName: "write_file",
    content: JSON.stringify({
      toolName: "write_file",
      ok: true,
      path: { view: "workspace", path: "reports/调查表.xlsx" },
      fileName: "调查表.xlsx",
    }),
    turnScopeId: TURN_SCOPE_ID,
    dialogProcessId: DIALOG_PROCESS_ID,
    ...extra,
  };
}

function writeMutationRef() {
  return assertMutationRef({
    mutationId: "mut_write_1",
    revision: 1,
    operation: "create",
    locator: { view: "host", path: "D:/work/调查表.csv" },
    fileName: "调查表.csv",
    beforeSha256: null,
    afterSha256: "sha_after_1",
    size: 12,
    additions: 2,
    deletions: 0,
    snapshot: "available",
  });
}

test("normalizeMessageEntity keeps tool mutationRefs through the mutation protocol", () => {
  const ref = writeMutationRef();
  const normalized = normalizeMessageEntity(toolResultMessage({ mutationRefs: [ref] }));
  assert.deepEqual(normalized.mutationRefs, [ref]);
  const empty = normalizeMessageEntity(toolResultMessage({ mutationRefs: [] }));
  assert.equal("mutationRefs" in empty, false);
});

test("normalizeMessageEntity rejects non-array and malformed mutationRefs", () => {
  assert.throws(
    () => normalizeMessageEntity(toolResultMessage({ mutationRefs: { mutationId: "x" } })),
    /mutationRefs must be an array/,
  );
  assert.throws(
    () => normalizeMessageEntity(toolResultMessage({ mutationRefs: [{ mutationId: "bad" }] })),
    /invalid file mutation reference/,
  );
});

test("reload projection keeps tool results that only carry mutationRefs", () => {
  const ref = writeMutationRef();
  const session = {
    sessionId: SESSION_ID,
    messages: [normalizeMessageEntity(toolResultMessage({ mutationRefs: [ref] }))],
  };
  const { timelineByRoute } = buildToolArtifactTimelineProjection(session);
  const [entry] = timelineByRoute.get(`${SESSION_ID}::${TURN_SCOPE_ID}`);
  assert.deepEqual(entry.resultEvent.mutationRefs, [ref]);
  assert.equal("resourceRefs" in entry.resultEvent, false);
});

test("reload projection rejects non-array tool result fact fields", () => {
  const session = {
    sessionId: SESSION_ID,
    messages: [toolResultMessage({ mutationRefs: "mut_write_1" })],
  };
  assert.throws(
    () => buildToolArtifactTimelineProjection(session),
    /tool result mutationRefs must be an array/,
  );
});

test("normalizeMessageEntity keeps tool resourceRefs through the resource protocol", () => {
  const resource = workspaceResource();
  const normalized = normalizeMessageEntity(toolResultMessage({ resourceRefs: [resource] }));
  assert.deepEqual(normalized.resourceRefs, [projectResourceRef(resource)]);
});

test("normalizeMessageEntity omits resourceRefs when the tool produced none", () => {
  const normalized = normalizeMessageEntity(toolResultMessage({ resourceRefs: [] }));
  assert.equal("resourceRefs" in normalized, false);
});

test("normalizeMessageEntity rejects non-array and malformed resourceRefs", () => {
  assert.throws(
    () => normalizeMessageEntity(toolResultMessage({ resourceRefs: { resourceId: "res_x" } })),
    /resourceRefs must be an array/,
  );
  assert.throws(
    () => normalizeMessageEntity(toolResultMessage({ resourceRefs: [{ resourceId: "bad" }] })),
    TypeError,
  );
});

test("reload projection rebuilds resultEvent.resourceRefs without empty attachments", () => {
  const resource = projectResourceRef(workspaceResource());
  const session = {
    sessionId: SESSION_ID,
    messages: [normalizeMessageEntity(toolResultMessage({ resourceRefs: [resource] }))],
  };
  const { timelineByRoute } = buildToolArtifactTimelineProjection(session);
  const [entry] = timelineByRoute.get(`${SESSION_ID}::${TURN_SCOPE_ID}`);
  assert.deepEqual(entry.resultEvent.resourceRefs, [resource]);
  assert.equal("attachments" in entry.resultEvent, false);
});

test("display merge keeps the same resourceRefs the live tool_call_end carried", () => {
  const resource = projectResourceRef(workspaceResource());
  const session = {
    sessionId: SESSION_ID,
    messages: [normalizeMessageEntity(toolResultMessage({ resourceRefs: [resource] }))],
  };
  const liveResultEvent = { timestamp: TEST_MESSAGE_TS, resourceRefs: [resource] };
  const presentation = {
    attachments: [],
    role: "assistant",
    turnScopeId: TURN_SCOPE_ID,
    dialogProcessId: DIALOG_PROCESS_ID,
    toolTimeline: [
      {
        key: "call:call_write_1",
        toolCallId: "call_write_1",
        tool: "write_file",
        status: "completed",
        resultEvent: liveResultEvent,
      },
    ],
  };
  const counts = attachSessionToolArtifacts(session, [presentation], SESSION_ID);
  assert.equal(counts.assignedToolArtifactCount, 1);
  assert.equal(presentation.toolTimeline.length, 1);
  assert.deepEqual(
    presentation.toolTimeline[0].resultEvent.resourceRefs,
    liveResultEvent.resourceRefs,
  );
  assert.equal("attachments" in presentation.toolTimeline[0].resultEvent, false);
});
