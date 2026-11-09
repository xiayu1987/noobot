/* Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { describe, expect, it } from "vitest";
import { projectAttachmentAccessRequest } from "@noobot/attachment-protocol";
import { buildAttachmentUrl } from "../../../../src/infrastructure/api/chat/chatApi.js";

describe("attachment access contract", () => {
  const request = {
    userId: "admin",
    attachmentId: "a/b",
    sessionId: "s",
    attachmentSource: "model",
  };
  it("rejects each missing required identity fact at the protocol boundary", () => {
    for (const field of Object.keys(request)) {
      for (const value of [undefined, "", " "]) {
        const invalid = { ...request, [field]: value };
        expect(() => projectAttachmentAccessRequest(invalid)).toThrow();
        expect(() => buildAttachmentUrl(invalid)).toThrow();
      }
    }
  });
  it("encodes the canonical access identity without accepting an explicit URL", () => {
    expect(buildAttachmentUrl({ ...request, url: "https://untrusted.test" })).toBe(
      "/api/internal/attachment/admin/a%2Fb?sessionId=s&attachmentSource=model",
    );
  });
});
