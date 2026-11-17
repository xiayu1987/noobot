/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import { expect } from "@playwright/test";
import { MODEL_CONTEXT_SEQUENCE_POLICY, MODEL_CONTEXT_TRACE } from "@noobot/model-protocol";
import { text } from "@noobot/shared/value";

export function assertModelInvocationTrace(record, { rootSessionId } = {}) {
  assert.equal(record.event, MODEL_CONTEXT_TRACE.EVENT);
  assert.equal(record.data?.stage, MODEL_CONTEXT_TRACE.INVOKE_STAGE);
  assert.equal(record.data?.authority, MODEL_CONTEXT_TRACE.INVOKE_AUTHORITY);
  assert.equal(record.data?.protocolVersion, MODEL_CONTEXT_TRACE.PROTOCOL_VERSION);
  assert.ok(
    Object.values(MODEL_CONTEXT_SEQUENCE_POLICY).includes(
      record.data?.invocation?.contextSequencePolicy,
    ),
  );
  assert.ok(record.data?.invocationId);
  assert.ok(record.data?.modelInstanceId);
  assert.ok(Number.isInteger(record.data?.attempt));
  assert.ok(record.data.attempt > 0);
  assert.ok(Number.isInteger(record.data?.invocationSequence));
  assert.ok(record.userId);
  assert.ok(record.sessionId);
  assert.ok(record.dialogProcessId);
  assert.ok(record.turnScopeId);
  if (rootSessionId) {
    assert.ok(record.sessionId === rootSessionId || record.parentSessionId === rootSessionId);
  }

  const messages = record.data.messages;
  assert.ok(Number.isInteger(messages?.count));
  assert.ok(messages.count > 0);
  assert.equal(
    Object.values(messages.roles || {}).reduce((sum, count) => sum + count, 0),
    messages.count,
  );
  assert.equal(
    (messages.dialogGroups || []).reduce((sum, group) => sum + group.count, 0) +
      messages.missingDialogIdCount,
    messages.count,
  );
  assert.ok(Array.isArray(messages.preview));
  assert.equal(messages.preview.length + Number(messages.truncated || 0), messages.count);
  assert.ok(Array.isArray(messages.evidence));
  assert.equal(messages.evidence.length, messages.count);
  assert.ok(Number.isInteger(messages.missingMessageUidCount));
  assert.equal(messages.fingerprintProtocolVersion, 2);
  assert.ok(Array.isArray(messages.fingerprints));
  assert.equal(messages.fingerprints.length, messages.count);
  assert.match(messages.sequenceHash, /^[a-f0-9]{64}$/);
  for (const fingerprint of messages.fingerprints) {
    assert.match(fingerprint, /^[a-f0-9]{64}$/);
  }
  if (
    record.data.invocation.contextSequencePolicy ===
    MODEL_CONTEXT_SEQUENCE_POLICY.CHECKPOINT_APPEND_ONLY
  ) {
    assert.ok(Number.isInteger(record.data.context?.summaryCheckpointRevision));
    assert.ok(record.data.context.summaryCheckpointRevision >= 0);
  } else {
    assert.equal(record.data.context, undefined);
  }
  const previewMissingMessageUids = messages.preview.filter(
    (message) => !message.messageUid,
  ).length;
  assert.ok(messages.missingMessageUidCount >= previewMissingMessageUids);
  assert.ok(
    messages.missingMessageUidCount <= previewMissingMessageUids + Number(messages.truncated || 0),
  );
  for (const message of messages.preview) {
    assert.equal(typeof message.role, "string");
    assert.ok(message.role.length > 0);
    if (message.messageUid !== undefined) {
      assert.equal(typeof message.messageUid, "string");
      assert.ok(message.messageUid.length > 0);
    }
    assert.match(message.contentHash, /^[a-f0-9]{16}$/);
    assert.equal(typeof message.contentPreview, "string");
  }
  for (const message of messages.evidence) {
    assert.equal(typeof message.role, "string");
    assert.ok(message.role.length > 0);
    assert.match(message.contentHash, /^[a-f0-9]{16}$/);
    assert.equal(message.contentPreview, undefined);
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
  const parsed = typeof record.ts === "string" ? Date.parse(record.ts) : NaN;
  if (!Number.isFinite(parsed)) throw new Error("model invocation trace requires a valid ts");
  return parsed;
}

export function auditModelPrefixStability(records = []) {
  const flows = new Map();
  (Array.isArray(records) ? records : []).forEach((record, sourceIndex) => {
    const key = modelFlowKey(record);
    const flow = flows.get(key) || [];
    flow.push({ record, sourceIndex, time: traceTime(record) });
    flows.set(key, flow);
  });

  const violations = [];
  const flowAudits = [];
  let stableComparisonCount = 0;
  let checkpointRewriteCount = 0;
  for (const [key, entries] of flows) {
    entries.sort((left, right) => left.time - right.time || left.sourceIndex - right.sourceIndex);
    let stableComparisons = 0;
    let checkpointRewrites = 0;
    const policies = new Set(
      entries.map(({ record }) => text(record.data?.invocation?.contextSequencePolicy)),
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
      const previousRevision = previous.data.context.summaryCheckpointRevision;
      const currentRevision = current.data.context.summaryCheckpointRevision;
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

export function auditModelSystemMessages(records = []) {
  const invocations = [];
  const violations = [];
  let mainInvocationCount = 0;
  let nonMainInvocationCount = 0;
  let systemMessageCount = 0;
  for (const record of Array.isArray(records) ? records : []) {
    const invocation = record?.data?.invocation || {};
    const messages = record?.data?.messages || {};
    const evidence = Array.isArray(messages.evidence) ? messages.evidence : [];
    const count = messages?.roles?.system;
    const identity = {
      invocationId: String(record?.data?.invocationId || ""),
      attempt: Number(record?.data?.attempt || 0),
      sessionId: String(record?.sessionId || ""),
      flow: String(invocation.flow || ""),
      purpose: String(invocation.purpose || ""),
      domain: String(invocation.domain || ""),
    };
    const isMain = isMainAgentModelInvocation(record);
    if (isMain) mainInvocationCount += 1;
    else nonMainInvocationCount += 1;
    if (!Number.isInteger(count) || count <= 0) {
      violations.push({ ...identity, type: "system_message_missing", observedCount: count });
      invocations.push({ ...identity, lane: isMain ? "main" : "non_main", systemMessageCount: 0 });
      continue;
    }
    systemMessageCount += count;
    const systemEvidence = evidence.filter((message) => message.role === "system");
    if (systemEvidence.length !== count) {
      violations.push({
        ...identity,
        type: "system_messages_not_fully_observable",
        systemMessageCount: count,
        observedSystemMessageCount: systemEvidence.length,
      });
    }
    for (const message of systemEvidence) {
      if (!Number.isInteger(message.contentLength) || message.contentLength <= 0) {
        violations.push({
          ...identity,
          type: "system_message_empty",
          messageIndex: message.index,
        });
      }
      if (!/^[a-f0-9]{16}$/.test(String(message.contentHash || ""))) {
        violations.push({
          ...identity,
          type: "system_message_hash_invalid",
          messageIndex: message.index,
        });
      }
    }
    invocations.push({
      ...identity,
      lane: isMain ? "main" : "non_main",
      systemMessageCount: count,
      systemMessageHashes: systemEvidence.map((message) => message.contentHash),
    });
  }
  return {
    status: violations.length ? "failed" : "passed",
    invocationCount: invocations.length,
    mainInvocationCount,
    nonMainInvocationCount,
    systemMessageCount,
    violations,
    invocations,
  };
}

export function assertModelSystemMessages(records = []) {
  const audit = auditModelSystemMessages(records);
  expect(audit.violations, "provider model system message audit violations").toEqual([]);
  return audit;
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
  const invocation = record.data?.invocation || {};
  return invocation.flow === "agent.main" && invocation.domain === "primary";
}

export function createModelInvocationTraceAudit({ rootSessionId } = {}) {
  const attemptsByInvocation = new Map();
  const sequencesByModel = new Map();
  const prefixRecords = [];
  return {
    observe(record) {
      assertModelInvocationTrace(record, { rootSessionId });
      const { invocationId, modelInstanceId, attempt, invocationSequence } = record.data;
      assert.equal(attempt, (attemptsByInvocation.get(invocationId) || 0) + 1);
      attemptsByInvocation.set(invocationId, attempt);
      assert.equal(invocationSequence, (sequencesByModel.get(modelInstanceId) || 0) + 1);
      sequencesByModel.set(modelInstanceId, invocationSequence);
      prefixRecords.push({
        ts: record.ts,
        sessionId: record.sessionId,
        parentSessionId: record.parentSessionId,
        dialogProcessId: record.dialogProcessId,
        data: {
          invocationId,
          invocation: record.data.invocation,
          context: record.data.context,
          messages: { fingerprints: record.data.messages.fingerprints },
        },
      });
    },
    finish() {
      expect(prefixRecords.length).toBeGreaterThan(0);
      const audit = auditModelPrefixStability(prefixRecords);
      expect(audit.violations, "provider model input prefix stability violations").toEqual([]);
      return audit;
    },
  };
}

export function assertModelInvocationTraceSet(records, options = {}) {
  const audit = createModelInvocationTraceAudit(options);
  for (const record of Array.isArray(records) ? records : []) audit.observe(record);
  return audit.finish();
}
