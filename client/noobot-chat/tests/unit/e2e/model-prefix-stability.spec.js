/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { describe, expect, it } from "vitest";
import { auditModelPrefixStability } from "../../e2e/protocol/helpers/model-message-assertions.js";
import { MODEL_CONTEXT_SEQUENCE_POLICY } from "@noobot/model-protocol";

function trace({
  id,
  fingerprints,
  revision = 0,
  purpose = "main_agent",
  ts,
  contextSequencePolicy = MODEL_CONTEXT_SEQUENCE_POLICY.CHECKPOINT_APPEND_ONLY,
  dialogProcessId = "dialog-1",
} = {}) {
  return {
    event: "model_context_trace",
    sessionId: "session-1",
    parentSessionId: "",
    dialogProcessId,
    ts,
    data: {
      invocationId: id,
      invocation: { flow: "agent.main", purpose, domain: "primary", contextSequencePolicy },
      context: { summaryCheckpointRevision: revision },
      messages: { fingerprints },
    },
  };
}

describe("model prefix stability audit", () => {
  it("accepts append-only growth and one checkpoint rewrite", () => {
    const audit = auditModelPrefixStability([
      trace({ id: "i1", fingerprints: ["a"], ts: "2026-01-01T00:00:01.000Z" }),
      trace({ id: "i2", fingerprints: ["a", "b"], ts: "2026-01-01T00:00:02.000Z" }),
      trace({ id: "i3", fingerprints: ["c"], revision: 1, ts: "2026-01-01T00:00:03.000Z" }),
      trace({ id: "i4", fingerprints: ["c", "d"], revision: 1, ts: "2026-01-01T00:00:04.000Z" }),
    ]);

    expect(audit.violations).toEqual([]);
    expect(audit.stableComparisonCount).toBe(2);
    expect(audit.checkpointRewriteCount).toBe(1);
    expect(audit.stableFlowCount).toBe(1);
  });

  it("does not compare independent complete requests as one prefix stream", () => {
    const policy = MODEL_CONTEXT_SEQUENCE_POLICY.INDEPENDENT_REQUEST;
    const audit = auditModelPrefixStability([
      trace({
        id: "i1",
        fingerprints: ["a", "b"],
        purpose: "memory",
        contextSequencePolicy: policy,
      }),
      trace({ id: "i2", fingerprints: ["x"], purpose: "memory", contextSequencePolicy: policy }),
    ]);

    expect(audit.violations).toEqual([]);
    expect(audit.independentFlowCount).toBe(1);
    expect(audit.stableComparisonCount).toBe(0);
  });

  it("starts a distinct checkpoint sequence for each dialog in the same session", () => {
    const audit = auditModelPrefixStability([
      trace({
        id: "dialog-1-checkpoint",
        fingerprints: ["summary"],
        revision: 1,
        dialogProcessId: "dialog-1",
        ts: "2026-01-01T00:00:01.000Z",
      }),
      trace({
        id: "dialog-2-start",
        fingerprints: ["history", "new-turn"],
        revision: 0,
        dialogProcessId: "dialog-2",
        ts: "2026-01-01T00:00:02.000Z",
      }),
    ]);

    expect(audit.violations).toEqual([]);
    expect(audit.insufficientSampleFlowCount).toBe(2);
  });

  it("rejects deletion and mutation without a checkpoint", () => {
    const audit = auditModelPrefixStability([
      trace({ id: "i1", fingerprints: ["a", "b"], ts: "2026-01-01T00:00:01.000Z" }),
      trace({ id: "i2", fingerprints: ["a"], ts: "2026-01-01T00:00:02.000Z" }),
      trace({ id: "i3", fingerprints: ["x", "c"], ts: "2026-01-01T00:00:03.000Z" }),
    ]);

    expect(audit.violations.map((item) => item.type)).toEqual([
      "message_count_decreased_without_checkpoint",
      "provider_prefix_changed_without_checkpoint",
    ]);
  });

  it("audits capability purposes independently and reports single samples", () => {
    const audit = auditModelPrefixStability([
      trace({ id: "p1", fingerprints: ["a"], purpose: "planning", ts: "2026-01-01T00:00:01.000Z" }),
      trace({ id: "g1", fingerprints: ["b"], purpose: "guidance", ts: "2026-01-01T00:00:02.000Z" }),
      trace({
        id: "g2",
        fingerprints: ["b", "c"],
        purpose: "guidance",
        ts: "2026-01-01T00:00:03.000Z",
      }),
    ]);

    expect(audit.violations).toEqual([]);
    expect(audit.checkedFlowCount).toBe(1);
    expect(audit.insufficientSampleFlowCount).toBe(1);
  });
});
