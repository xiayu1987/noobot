/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { describe, expect, it } from "vitest";
import {
  getMessageTransferAttachments,
  getMessageTransferEnvelopes,
  normalizeTransferEnvelopes,
} from "../../../../../src/modules/chat/model/transferEnvelopes.js";

const attachmentIdentity = {
  attachmentId: "att-1",
  sessionId: "session-1",
  attachmentSource: "model",
};

const envelope = {
  protocol: "noobot.semantic-transfer",
  version: 2,
  transferId: "transfer-1",
  messageId: "message-1",
  identity: {
    sessionId: "session-1",
    turnScopeId: "turn-1",
    runId: "run-1",
    producer: { type: "tool", id: "call-1" },
  },
  direction: "output",
  payload: {
    mode: "attachment",
    attachments: [{
      identity: attachmentIdentity,
      role: "primary",
      name: "report.md",
      mimeType: "text/markdown",
      size: 10,
      preview: "report",
    }],
  },
  intent: {
    source: "tool",
    reason: "semantic_transfer_tool_result",
    scenario: "tool",
    strategy: "tool_result_text",
  },
  meta: { originalLength: 10, persisted: true },
};

describe("transferEnvelopes", () => {
  it("normalizes only strict V2 envelope collections", () => {
    expect(normalizeTransferEnvelopes([envelope])).toEqual([envelope]);
    expect(() => normalizeTransferEnvelopes([{ protocol: "legacy" }])).toThrow(
      /invalid_transfer_envelope/,
    );
    expect(() => normalizeTransferEnvelopes([{ ...envelope, version: 1 }])).toThrow(
      /invalid_transfer_envelope/,
    );
  });

  it("projects attachment identity without any path fields", () => {
    expect(getMessageTransferAttachments({ transferEnvelopes: [envelope] })).toEqual([
      expect.objectContaining({
        attachmentId: "att-1",
        sessionId: "session-1",
        attachmentSource: "model",
        name: "report.md",
        transferId: "transfer-1",
        messageId: "message-1",
        transferRole: "primary",
      }),
    ]);
    expect(getMessageTransferAttachments({ transferEnvelopes: [envelope] })[0]).not.toHaveProperty("path");
  });

  it("rejects legacy and path-based envelopes instead of translating them", () => {
    expect(() => getMessageTransferAttachments({
      transferEnvelopes: [{ ...envelope, version: 1, files: [{ filePath: "/legacy/a.txt" }] }],
    })).toThrow(/invalid_transfer_envelope/);
    expect(() => getMessageTransferAttachments({
      transferEnvelopes: [{ ...envelope, filePath: "/legacy/a.txt" }],
    })).toThrow(/invalid_transfer_envelope/);
  });

  it("collects valid envelopes from the canonical transfer field only", () => {
    expect(getMessageTransferEnvelopes({ transferEnvelopes: [envelope], files: [envelope] })).toEqual([envelope]);
  });
});
