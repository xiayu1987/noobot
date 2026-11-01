/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  EXTENSION_CONTEXT_ERROR_CODE,
  HOST_CAPABILITY_ERROR_CODE,
  MESSAGE_CARD_HOST_CAPABILITIES,
  MESSAGE_CARD_HOST_STATES,
  MESSAGE_CARD_HOST_STATE_VERSION,
  SESSION_ARTIFACT_PANEL_CONTEXT_FIELDS,
  createSessionArtifactPanelContext,
  requireMessageCardHostCapabilities,
  requireRuntimeStreamRouteContext,
  requireSelectedExecutionDetail,
  requireSelectedSessionDocument,
} from "../src/frontend.js";

function completeContext() {
  return {
    ...Object.fromEntries(MESSAGE_CARD_HOST_CAPABILITIES.map((name) => [name, () => null])),
    ...Object.fromEntries(MESSAGE_CARD_HOST_STATES.map((name) => [name, {}])),
    [MESSAGE_CARD_HOST_STATE_VERSION]: 0,
  };
}

function executionDetail() {
  return {
    execution: { executionId: "execution-a", sessionId: "child-a", turnScopeId: "turn-a" },
    session: { sessionId: "child-a", messages: [] },
    children: [],
    descendants: [],
  };
}

test("selector results preserve unavailable null and loaded empty documents without copying", () => {
  const target = { executionId: "execution-a", sessionId: "child-a" };
  assert.equal(requireSelectedExecutionDetail(null, target), null);
  assert.equal(requireSelectedSessionDocument(null, target.sessionId), null);
  const detail = executionDetail();
  assert.equal(requireSelectedExecutionDetail(detail, target), detail);
  assert.equal(requireSelectedSessionDocument(detail.session, target.sessionId), detail.session);
});

test("session selector rejects malformed results instead of treating them as unloaded", () => {
  for (const document of [
    undefined,
    false,
    [],
    {},
    { sessionId: "other", messages: [] },
    { sessionId: "child-a" },
    { sessionId: "child-a", messages: null },
  ]) {
    assert.throws(() => requireSelectedSessionDocument(document, "child-a"), TypeError);
  }
});

test("execution selector rejects missing facts, conflicting identity and malformed arrays", () => {
  const target = { executionId: "execution-a", sessionId: "child-a" };
  for (const field of ["executionId", "sessionId", "turnScopeId"]) {
    const detail = executionDetail();
    delete detail.execution[field];
    assert.throws(() => requireSelectedExecutionDetail(detail, target), TypeError);
  }
  for (const field of ["children", "descendants"]) {
    for (const value of [undefined, null, {}]) {
      const detail = { ...executionDetail(), [field]: value };
      assert.throws(() => requireSelectedExecutionDetail(detail, target), TypeError);
    }
  }
  for (const detail of [
    undefined,
    false,
    [],
    {},
    { ...executionDetail(), session: null },
    { ...executionDetail(), session: { sessionId: "root", messages: [] } },
  ]) {
    assert.throws(() => requireSelectedExecutionDetail(detail, target), TypeError);
  }
  assert.throws(
    () =>
      requireSelectedExecutionDetail(executionDetail(), {
        ...target,
        executionId: "another-execution",
      }),
    TypeError,
  );
  assert.throws(
    () =>
      requireSelectedExecutionDetail(executionDetail(), {
        ...target,
        sessionId: "root",
      }),
    /belongs to another session/,
  );
});

test("execution selector preserves ordered records and rejects damaged or duplicate list identities", () => {
  const root = executionDetail();
  const child = Object.freeze({
    executionId: "execution-child",
    sessionId: "child-session",
    turnScopeId: "child-turn",
  });
  const grandchild = Object.freeze({
    executionId: "execution-grandchild",
    sessionId: "grandchild-session",
    turnScopeId: "grandchild-turn",
  });
  const detail = Object.freeze({
    ...root,
    children: Object.freeze([child]),
    descendants: Object.freeze([child, grandchild]),
  });
  const target = { executionId: root.execution.executionId };
  assert.equal(requireSelectedExecutionDetail(detail, target), detail);
  assert.equal(detail.children[0], detail.descendants[0]);
  for (const field of ["children", "descendants"]) {
    for (const value of [
      [null],
      [{}],
      [{ ...child, executionId: " execution-child" }],
      [{ ...child, sessionId: "" }],
      [{ ...child, turnScopeId: undefined }],
      [child, child],
      [root.execution],
    ]) {
      assert.throws(
        () => requireSelectedExecutionDetail({ ...detail, [field]: value }, target),
        /selected execution list/,
      );
    }
  }
});

function assertMissing(context, name) {
  assert.throws(
    () => requireMessageCardHostCapabilities(context),
    (error) =>
      error instanceof TypeError &&
      error.code === HOST_CAPABILITY_ERROR_CODE.MISSING &&
      error.message.endsWith(name),
  );
}

test("message card host contract lists are the single contract", () => {
  assert.deepEqual(MESSAGE_CARD_HOST_CAPABILITIES, [
    "selectExecutionDetail",
    "stopExecution",
    "fetchExecutionReport",
    "selectSessionMessages",
    "applyWorkflowRuntimeEvent",
    "logWorkflowDiagnostics",
    "renderMarkdown",
    "formatTime",
    "formatFileSize",
    "isImageMime",
  ]);
  assert.deepEqual(MESSAGE_CARD_HOST_STATES, [
    "workflowNodeStateRegistry",
    "subSessionMessageRegistry",
  ]);
  assert.equal(MESSAGE_CARD_HOST_STATE_VERSION, "subSessionMessageRegistryVersion");
});

test("complete host context passes through unchanged", () => {
  const context = completeContext();
  assert.equal(requireMessageCardHostCapabilities(context), context);
});

test("missing or non-function host capability is rejected", () => {
  for (const name of MESSAGE_CARD_HOST_CAPABILITIES) {
    for (const value of [undefined, null, "fn"]) {
      assertMissing({ ...completeContext(), [name]: value }, name);
    }
  }
  assert.throws(() => requireMessageCardHostCapabilities(null), TypeError);
});

test("missing or non-record host state is rejected", () => {
  for (const name of MESSAGE_CARD_HOST_STATES) {
    for (const value of [undefined, null, [], "registry"]) {
      assertMissing({ ...completeContext(), [name]: value }, name);
    }
  }
});

test("non-integer registry version is rejected", () => {
  for (const value of [undefined, null, "1", 1.5]) {
    assertMissing(
      { ...completeContext(), [MESSAGE_CARD_HOST_STATE_VERSION]: value },
      MESSAGE_CARD_HOST_STATE_VERSION,
    );
  }
});

test("session artifact panel context carries only the declared fields", () => {
  const context = createSessionArtifactPanelContext({
    sessionId: "session-1",
    panelResizing: false,
    panelResizeRevision: 0,
  });
  assert.deepEqual(Object.keys(context), [...SESSION_ARTIFACT_PANEL_CONTEXT_FIELDS]);
  assert.equal(Object.isFrozen(context), true);
});

test("session artifact panel context rejects invalid fields", () => {
  const valid = { sessionId: "session-1", panelResizing: true, panelResizeRevision: 2 };
  for (const [field, value] of [
    ["sessionId", ""],
    ["sessionId", " session-1"],
    ["panelResizing", undefined],
    ["panelResizeRevision", -1],
    ["panelResizeRevision", 1.5],
  ]) {
    assert.throws(
      () => createSessionArtifactPanelContext({ ...valid, [field]: value }),
      (error) =>
        error instanceof TypeError &&
        error.code === EXTENSION_CONTEXT_ERROR_CODE.INVALID &&
        error.message.endsWith(field),
    );
  }
});

test("runtime stream context preserves live capabilities and optional diagnostics", () => {
  for (const source of ["live", "reconnect"]) {
    let activeSessionId = "session-1";
    const context = {
      source,
      isCurrentActiveSession: (sessionId) => sessionId === activeSessionId,
    };
    assert.equal(requireRuntimeStreamRouteContext(context), context);
    assert.equal(context.isCurrentActiveSession(activeSessionId), true);
    activeSessionId = "session-2";
    assert.equal(context.isCurrentActiveSession("session-1"), false);
    const withDiagnostics = { ...context, logRuntimeProjectionDiagnostics: () => {} };
    assert.equal(requireRuntimeStreamRouteContext(withDiagnostics), withDiagnostics);
  }
});

test("runtime stream context rejects malformed source and capability contracts", () => {
  const valid = { source: "live", isCurrentActiveSession: () => true };
  for (const [field, value] of [
    ["source", undefined],
    ["source", " live "],
    ["source", "unknown"],
    ["isCurrentActiveSession", undefined],
    ["isCurrentActiveSession", null],
    ["isCurrentActiveSession", true],
    ["logRuntimeProjectionDiagnostics", null],
    ["logRuntimeProjectionDiagnostics", "logger"],
  ]) {
    assert.throws(
      () => requireRuntimeStreamRouteContext({ ...valid, [field]: value }),
      (error) =>
        error.code === EXTENSION_CONTEXT_ERROR_CODE.INVALID && error.message.endsWith(field),
    );
  }
  for (const value of [undefined, null, [], "context"]) {
    assert.throws(() => requireRuntimeStreamRouteContext(value), {
      code: EXTENSION_CONTEXT_ERROR_CODE.INVALID,
    });
  }
});
