/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { describe, expect, it } from "vitest";

import { mergeAttachments } from "../../../../../src/modules/chat/model/dialogProcessChain.js";

describe("dialogProcessChain authoritative attachment projection", () => {
  it("uses the incoming projection as authority for an existing identity", () => {
    const existing = [
      {
        attachmentId: "att-1",
        sessionId: "session-a",
        attachmentSource: "user",
        name: "stale.txt",
        previewUrl: "blob:http://localhost/stale",
      },
    ];
    const incoming = [
      {
        attachmentId: "att-1",
        sessionId: "session-a",
        attachmentSource: "user",
        name: "current.txt",
      },
    ];

    expect(mergeAttachments(existing, incoming)).toEqual(incoming);
  });

  it("keeps distinct stable identities separate", () => {
    const existing = [
      {
        attachmentId: "shared",
        sessionId: "session-a",
        attachmentSource: "user",
        name: "a.txt",
      },
    ];
    const incoming = [
      { attachmentId: "shared", sessionId: "session-b", attachmentSource: "user", name: "b.txt" },
      {
        attachmentId: "shared",
        sessionId: "session-a",
        attachmentSource: "model",
        name: "model.txt",
      },
    ];

    expect(mergeAttachments(existing, incoming)).toEqual([...existing, ...incoming]);
  });

  it("rejects incomplete canonical identities", () => {
    expect(() => mergeAttachments([], [{ attachmentId: "att-1", sessionId: "session-a" }])).toThrow(
      /invalid_attachment_source/,
    );
    expect(() =>
      mergeAttachments([], [{ attachmentId: "att-1", attachmentSource: "user" }]),
    ).toThrow(/invalid_attachment_session_id/);
  });
});
