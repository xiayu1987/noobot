/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { describe, expect, it } from "vitest";

import { auditModelSystemMessages } from "../../e2e/protocol/helpers/model-message-assertions.js";

function trace({ flow = "agent.main", roles = { system: 1, user: 1 }, evidence } = {}) {
  return {
    sessionId: "session-1",
    data: {
      invocationId: `invocation-${flow}`,
      attempt: 1,
      invocation: { flow, purpose: "test", domain: flow === "agent.main" ? "primary" : "planning" },
      messages: {
        roles,
        evidence: evidence || [
          { index: 0, role: "system", contentLength: 10, contentHash: "a".repeat(16) },
          { index: 1, role: "user", contentLength: 4, contentHash: "b".repeat(16) },
        ],
      },
    },
  };
}

describe("model system message E2E audit", () => {
  it("audits main and non-main provider invocations from the same authority", () => {
    const audit = auditModelSystemMessages([
      trace(),
      trace({ flow: "plugin.analysis" }),
    ]);

    expect(audit.status).toBe("passed");
    expect(audit.mainInvocationCount).toBe(1);
    expect(audit.nonMainInvocationCount).toBe(1);
    expect(audit.systemMessageCount).toBe(2);
    expect(audit.violations).toEqual([]);
  });

  it("rejects missing and invalid system messages without inferring message order", () => {
    const audit = auditModelSystemMessages([
      trace({ roles: { user: 1 }, evidence: [
        { index: 0, role: "user", contentLength: 4, contentHash: "b".repeat(16) },
      ] }),
      trace({
        flow: "plugin.analysis",
        roles: { system: 1, user: 1 },
        evidence: [
          { index: 0, role: "user", contentLength: 4, contentHash: "b".repeat(16) },
          { index: 1, role: "system", contentLength: 0, contentHash: "invalid" },
        ],
      }),
    ]);

    expect(audit.status).toBe("failed");
    expect(audit.violations.map((item) => item.type)).toEqual(expect.arrayContaining([
      "system_message_missing",
      "system_message_empty",
      "system_message_hash_invalid",
    ]));
  });
});
