/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { expect } from "@playwright/test";
import { MODEL_CONTEXT_SEQUENCE_POLICY } from "@noobot/model-protocol";

export function assertModelInvocationTrace(record, { rootSessionId } = {}) {
  expect(record.event).toBe("model_context_trace");
  expect(record.data?.stage).toBe("llm_invoke_messages");
  expect(record.data?.authority).toBe("model_invoke_port");
  expect(record.data?.protocolVersion).toBe(2);
  expect(Object.values(MODEL_CONTEXT_SEQUENCE_POLICY)).toContain(
    record.data?.invocation?.contextSequencePolicy,
  );
  expect(record.data?.invocationId).toBeTruthy();
  expect(record.data?.modelInstanceId).toBeTruthy();
  expect(Number.isInteger(record.data?.invocationSequence)).toBe(true);
  expect(record.userId).toBeTruthy();
  expect(record.sessionId).toBeTruthy();
  expect(record.dialogProcessId).toBeTruthy();
  expect(record.turnScopeId).toBeTruthy();
  if (rootSessionId) {
    expect(record.sessionId === rootSessionId || record.parentSessionId === rootSessionId).toBe(
      true,
    );
  }

  const messages = record.data.messages;
  expect(Number.isInteger(messages?.count)).toBe(true);
  expect(messages.count).toBeGreaterThan(0);
  expect(Object.values(messages.roles || {}).reduce((sum, count) => sum + count, 0)).toBe(
    messages.count,
  );
  expect(
    (messages.dialogGroups || []).reduce((sum, group) => sum + group.count, 0) +
      messages.missingDialogIdCount,
  ).toBe(messages.count);
  expect(Array.isArray(messages.preview)).toBe(true);
  expect(messages.preview.length + Number(messages.truncated || 0)).toBe(messages.count);
  expect(Number.isInteger(messages.missingMessageIdCount)).toBe(true);
  expect(messages.fingerprintProtocolVersion).toBe(1);
  expect(Array.isArray(messages.fingerprints)).toBe(true);
  expect(messages.fingerprints).toHaveLength(messages.count);
  expect(messages.sequenceHash).toMatch(/^[a-f0-9]{64}$/);
  for (const fingerprint of messages.fingerprints) {
    expect(fingerprint).toMatch(/^[a-f0-9]{64}$/);
  }
  expect(Number.isInteger(record.data?.context?.summaryCheckpointRevision)).toBe(true);
  expect(record.data.context.summaryCheckpointRevision).toBeGreaterThanOrEqual(0);
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

function modelFlowKey(record = {}) {
  const invocation = record.data?.invocation || {};
  return [
    String(record.sessionId || ""),
    String(record.parentSessionId || ""),
    String(record.dialogProcessId || ""),
    String(invocation.flow || ""),
    String(invocation.purpose || ""),
    String(invocation.domain || ""),
  ].join("\u0000");
}

function isPrefix(previous = [], current = []) {
  return (
    previous.length <= current.length &&
    previous.every((fingerprint, index) => current[index] === fingerprint)
  );
}

function traceTime(record = {}) {
  const parsed = Date.parse(record.ts || record.timestamp || "");
  return Number.isFinite(parsed) ? parsed : 0;
}

export function auditModelPrefixStability(records = []) {
  const flows = new Map();
  (Array.isArray(records) ? records : []).forEach((record, sourceIndex) => {
    const key = modelFlowKey(record);
    const flow = flows.get(key) || [];
    flow.push({ record, sourceIndex });
    flows.set(key, flow);
  });

  const violations = [];
  const flowAudits = [];
  let stableComparisonCount = 0;
  let checkpointRewriteCount = 0;
  for (const [key, entries] of flows) {
    entries.sort(
      (left, right) =>
        traceTime(left.record) - traceTime(right.record) || left.sourceIndex - right.sourceIndex,
    );
    let stableComparisons = 0;
    let checkpointRewrites = 0;
    const policies = new Set(
      entries.map(({ record }) =>
        String(record.data?.invocation?.contextSequencePolicy || "").trim(),
      ),
    );
    const contextSequencePolicy = [...policies][0] || "";
    if (
      policies.size !== 1 ||
      !Object.values(MODEL_CONTEXT_SEQUENCE_POLICY).includes(contextSequencePolicy)
    ) {
      violations.push({
        flow: key,
        type:
          policies.size !== 1
            ? "context_sequence_policy_changed"
            : "invalid_context_sequence_policy",
        policies: [...policies],
      });
    }
    if (contextSequencePolicy === MODEL_CONTEXT_SEQUENCE_POLICY.INDEPENDENT_REQUEST) {
      const first = entries[0]?.record || {};
      flowAudits.push({
        key,
        sessionId: first.sessionId || "",
        parentSessionId: first.parentSessionId || "",
        invocation: first.data?.invocation || {},
        contextSequencePolicy,
        sampleCount: entries.length,
        status: violations.some((violation) => violation.flow === key) ? "failed" : "independent",
        stableComparisons: 0,
        checkpointRewrites: 0,
      });
      continue;
    }
    for (let index = 1; index < entries.length; index += 1) {
      const previous = entries[index - 1].record;
      const current = entries[index].record;
      const previousRevision = Number(previous.data?.context?.summaryCheckpointRevision || 0);
      const currentRevision = Number(current.data?.context?.summaryCheckpointRevision || 0);
      const previousFingerprints = previous.data?.messages?.fingerprints || [];
      const currentFingerprints = current.data?.messages?.fingerprints || [];
      if (currentRevision < previousRevision) {
        violations.push({
          flow: key,
          type: "checkpoint_revision_regressed",
          previousInvocationId: previous.data?.invocationId,
          currentInvocationId: current.data?.invocationId,
          previousRevision,
          currentRevision,
        });
        continue;
      }
      if (currentRevision > previousRevision) {
        checkpointRewrites += 1;
        checkpointRewriteCount += 1;
        continue;
      }
      stableComparisons += 1;
      stableComparisonCount += 1;
      if (isPrefix(previousFingerprints, currentFingerprints)) continue;
      violations.push({
        flow: key,
        type:
          currentFingerprints.length < previousFingerprints.length
            ? "message_count_decreased_without_checkpoint"
            : "provider_prefix_changed_without_checkpoint",
        previousInvocationId: previous.data?.invocationId,
        currentInvocationId: current.data?.invocationId,
        checkpointRevision: currentRevision,
        previousMessageCount: previousFingerprints.length,
        currentMessageCount: currentFingerprints.length,
      });
    }
    const first = entries[0]?.record || {};
    flowAudits.push({
      key,
      sessionId: first.sessionId || "",
      parentSessionId: first.parentSessionId || "",
      invocation: first.data?.invocation || {},
      contextSequencePolicy,
      sampleCount: entries.length,
      status:
        entries.length < 2
          ? "insufficient_samples"
          : violations.some((violation) => violation.flow === key)
            ? "failed"
            : "stable",
      stableComparisons,
      checkpointRewrites,
    });
  }
  return {
    checkedFlowCount: flowAudits.filter(
      (flow) =>
        flow.contextSequencePolicy === MODEL_CONTEXT_SEQUENCE_POLICY.CHECKPOINT_APPEND_ONLY &&
        flow.sampleCount >= 2,
    ).length,
    stableFlowCount: flowAudits.filter((flow) => flow.status === "stable").length,
    insufficientSampleFlowCount: flowAudits.filter((flow) => flow.status === "insufficient_samples")
      .length,
    independentFlowCount: flowAudits.filter((flow) => flow.status === "independent").length,
    stableComparisonCount,
    checkpointRewriteCount,
    violations,
    flows: flowAudits,
  };
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
  const prefixAudit = auditModelPrefixStability(traces);
  expect(prefixAudit.violations, "provider model input prefix stability violations").toEqual([]);
  return prefixAudit;
}
