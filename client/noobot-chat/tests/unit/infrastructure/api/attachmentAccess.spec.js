/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { describe, expect, it } from "vitest";

import {
  buildParsedResultPreviewItem,
  mergeAttachmentDisplayItems,
  resolveAttachmentAccessMeta,
  resolveAttachmentDisplayKey,
  resolveParsedResultAccessMeta,
} from "../../../../src/infrastructure/api/attachments/attachmentAccess.js";

describe("attachmentAccess", () => {
  it("keeps draft and canonical attachment display identities explicit", () => {
    const draft = {
      clientAttachmentId: "draft-1",
      name: "pending.png",
      mimeType: "image/png",
    };
    const canonical = {
      attachmentId: "file-1",
      sessionId: "session-1",
      attachmentSource: "user",
      name: "pending.png",
    };

    expect(resolveAttachmentDisplayKey(draft)).toBe("draft:draft-1");
    expect(resolveAttachmentDisplayKey(canonical)).toContain("canonical:");
    expect(resolveParsedResultAccessMeta(draft)).toBeNull();
    expect(mergeAttachmentDisplayItems([draft], [canonical])).toEqual([draft, canonical]);
  });

  it("ignores explicit source urls and builds access from attachment identity", () => {
    expect(
      resolveAttachmentAccessMeta(
        {
          attachmentId: "file-1",
          sessionId: "session-1",
          attachmentSource: "upload",
          previewUrl: "https://attacker.example/legacy-preview",
          url: "/api/internal/unrelated",
        },
        { userId: "admin" },
      ),
    ).toMatchObject({
      attachmentId: "file-1",
      sessionId: "session-1",
      attachmentSource: "upload",
      url: "/api/internal/attachment/admin/file-1?sessionId=session-1&attachmentSource=upload",
    });
  });

  it("builds source attachment access urls from attachment identity when explicit urls are missing", () => {
    expect(
      resolveAttachmentAccessMeta(
        {
          attachmentId: "file-1",
          sessionId: "session-1",
          attachmentSource: "upload",
        },
        { userId: "admin" },
      ),
    ).toMatchObject({
      attachmentId: "file-1",
      sessionId: "session-1",
      attachmentSource: "upload",
      url: "/api/internal/attachment/admin/file-1?sessionId=session-1&attachmentSource=upload",
    });
  });

  it("resolves parsed result access from the canonical relation", () => {
    const meta = resolveParsedResultAccessMeta(
      {
        attachmentId: "source-1",
        sessionId: "session-1",
        attachmentSource: "upload",
        relations: [
          {
            relationType: "parsed_result",
            sourceIdentity: {
              attachmentId: "source-1",
              sessionId: "session-1",
              attachmentSource: "upload",
            },
            targetIdentity: {
              attachmentId: "parsed-1",
              sessionId: "session-1",
              attachmentSource: "model",
            },
            name: "report.md",
            mimeType: "text/markdown",
            size: 512,
            createdAt: "2026-01-01T00:00:00.000Z",
          },
        ],
      },
      { userId: "admin" },
    );

    expect(meta).toMatchObject({
      attachmentId: "parsed-1",
      sessionId: "session-1",
      attachmentSource: "model",
      url: "/api/internal/attachment/admin/parsed-1?sessionId=session-1&attachmentSource=model",
      name: "report.md",
      mimeType: "text/markdown",
      size: 512,
    });
  });

  it("returns no parsed access when the canonical relation is absent", () => {
    expect(
      resolveParsedResultAccessMeta({
        attachmentId: "source-1",
        sessionId: "session-1",
        attachmentSource: "upload",
        relations: [],
      }),
    ).toBeNull();
  });

  it("builds preview items from parsed result size and type, not source attachment size", () => {
    expect(
      buildParsedResultPreviewItem({
        attachmentId: "source-1",
        sessionId: "session-1",
        attachmentSource: "upload",
        name: "source.docx",
        size: 2 * 1024 * 1024,
        relations: [
          {
            relationType: "parsed_result",
            sourceIdentity: {
              attachmentId: "source-1",
              sessionId: "session-1",
              attachmentSource: "upload",
            },
            targetIdentity: {
              attachmentId: "parsed-1",
              sessionId: "session-1",
              attachmentSource: "model",
            },
            name: "source.md",
            mimeType: "text/markdown",
            size: 256,
            createdAt: "2026-01-01T00:00:00.000Z",
          },
        ],
      }),
    ).toMatchObject({
      attachmentId: "parsed-1",
      name: "source.md",
      mimeType: "text/markdown",
      size: 256,
    });
  });
});
