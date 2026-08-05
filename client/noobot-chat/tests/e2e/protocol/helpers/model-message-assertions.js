/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { expect } from "@playwright/test";

export function assertModelInvocationTrace(record, { rootSessionId } = {}) {
  expect(record.event).toBe("model_context_trace");
  expect(record.data?.stage).toBe("llm_invoke_messages");
  expect(record.data?.authority).toBe("model_invoke_port");
  expect(record.data?.protocolVersion).toBe(1);
  expect(record.data?.invocationId).toBeTruthy();
  expect(record.data?.modelInstanceId).toBeTruthy();
  expect(Number.isInteger(record.data?.invocationSequence)).toBe(true);
  expect(record.userId).toBeTruthy();
  expect(record.sessionId).toBeTruthy();
  expect(record.dialogProcessId).toBeTruthy();
  expect(record.turnScopeId).toBeTruthy();
  if (rootSessionId) {
    expect(record.sessionId === rootSessionId || record.parentSessionId === rootSessionId).toBe(true);
  }

  const messages = record.data.messages;
  expect(Number.isInteger(messages?.count)).toBe(true);
  expect(messages.count).toBeGreaterThan(0);
  expect(Object.values(messages.roles || {}).reduce((sum, count) => sum + count, 0)).toBe(messages.count);
  expect((messages.dialogGroups || []).reduce((sum, group) => sum + group.count, 0)
    + messages.missingDialogIdCount).toBe(messages.count);
  expect(Array.isArray(messages.preview)).toBe(true);
  expect(messages.preview.length + Number(messages.truncated || 0)).toBe(messages.count);
  expect(Number.isInteger(messages.missingMessageIdCount)).toBe(true);
  const previewMissingMessageIds = messages.preview.filter((message) => !message.messageId).length;
  expect(messages.missingMessageIdCount).toBeGreaterThanOrEqual(previewMissingMessageIds);
  expect(messages.missingMessageIdCount).toBeLessThanOrEqual(
    previewMissingMessageIds + Number(messages.truncated || 0),
  );
  for (const message of messages.preview) {
    expect(typeof message.role).toBe("string");
    expect(message.role.length).toBeGreaterThan(0);
    if (message.messageId !== undefined) {
      expect(typeof message.messageId).toBe("string");
      expect(message.messageId.length).toBeGreaterThan(0);
    }
    expect(message.contentHash).toMatch(/^[a-f0-9]{16}$/);
    expect(typeof message.contentPreview).toBe("string");
  }
}

export function assertRootModelInvocation(record, rootSessionId, turnScopeId) {
  expect(record).toBeTruthy();
  expect(record.sessionId).toBe(rootSessionId);
  expect(record.parentSessionId || "").toBe("");
  expect(record.turnScopeId).toBe(turnScopeId);
}

export function assertWorkflowChildModelInvocation(record, rootSessionId) {
  expect(record).toBeTruthy();
  expect(record.sessionId).not.toBe(rootSessionId);
  expect(record.parentSessionId).toBe(rootSessionId);
  expect(record.turnScopeId).toMatch(/^workflow-node:/);
  expect(record.dialogProcessId).toMatch(/^wf_node_/);
}

export function isMainAgentModelInvocation(record) {
  return record.data?.invocation?.purpose === "main_agent";
}

export function assertModelInvocationTraceSet(records, { rootSessionId } = {}) {
  const traces = Array.isArray(records) ? records : [];
  expect(traces.length).toBeGreaterThan(0);
  traces.forEach((record) => assertModelInvocationTrace(record, { rootSessionId }));

  const invocationIds = traces.map((record) => record.data.invocationId);
  expect(new Set(invocationIds).size).toBe(invocationIds.length);

  const sequencesByModel = new Map();
  for (const record of traces) {
    const modelInstanceId = record.data.modelInstanceId;
    const sequences = sequencesByModel.get(modelInstanceId) || [];
    sequences.push(record.data.invocationSequence);
    sequencesByModel.set(modelInstanceId, sequences);
  }
  for (const sequences of sequencesByModel.values()) {
    expect(sequences).toEqual(sequences.map((_, index) => index + 1));
  }
}
