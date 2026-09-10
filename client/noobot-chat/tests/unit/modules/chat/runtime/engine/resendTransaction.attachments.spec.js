/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { describe, expect, it } from "vitest";
import { attachmentIdentityKey, projectAttachmentIdentity } from "@noobot/attachment-protocol";
import { resolveKeptAttachments } from "../../../../../../src/modules/chat/runtime/engine/resendTransaction.js";

const identityKeyOf = (attachment) => attachmentIdentityKey(projectAttachmentIdentity(attachment));

const attachment = (attachmentId, overrides = {}) => ({
  sessionId: "session-1",
  attachmentSource: "user_upload",
  attachmentId,
  fileName: `${attachmentId}.txt`,
  ...overrides,
});

describe("resolveKeptAttachments", () => {
  it("keeps every authoritative attachment when nothing is removed", () => {
    const kept = resolveKeptAttachments({ attachments: [attachment("a"), attachment("b")] }, {});
    expect(kept.map((item) => item.attachmentId)).toEqual(["a", "b"]);
  });

  it("drops attachments whose identity key is listed as removed", () => {
    const removed = attachment("b");
    const kept = resolveKeptAttachments(
      { attachments: [attachment("a"), removed, attachment("c")] },
      { removedAttachmentKeys: [identityKeyOf(removed)] },
    );
    expect(kept.map((item) => item.attachmentId)).toEqual(["a", "c"]);
  });

  it("ignores blank and whitespace-only removal keys", () => {
    const kept = resolveKeptAttachments(
      { attachments: [attachment("a")] },
      { removedAttachmentKeys: ["", "   ", null, undefined] },
    );
    expect(kept.map((item) => item.attachmentId)).toEqual(["a"]);
  });

  it("trims removal keys before matching", () => {
    const removed = attachment("a");
    const kept = resolveKeptAttachments(
      { attachments: [removed] },
      { removedAttachmentKeys: [`  ${identityKeyOf(removed)}  `] },
    );
    expect(kept).toEqual([]);
  });

  it("merges option attachments and deduplicates by identity", () => {
    const shared = attachment("a");
    const kept = resolveKeptAttachments(
      { attachments: [shared] },
      { attachments: [shared, attachment("b")] },
    );
    expect(kept.map((item) => item.attachmentId)).toEqual(["a", "b"]);
  });

  it("strips raw and file carriers from returned metadata", () => {
    const kept = resolveKeptAttachments(
      { attachments: [attachment("a", { raw: { blob: 1 }, file: { name: "a.txt" } })] },
      {},
    );
    expect(kept[0]).not.toHaveProperty("raw");
    expect(kept[0]).not.toHaveProperty("file");
    expect(kept[0].fileName).toBe("a.txt");
  });

  it("tolerates missing attachments and non-array inputs", () => {
    expect(resolveKeptAttachments({}, {})).toEqual([]);
    expect(resolveKeptAttachments({ attachments: null }, { attachments: "nope" })).toEqual([]);
    expect(resolveKeptAttachments(undefined, undefined)).toEqual([]);
    expect(resolveKeptAttachments({ attachments: [] }, { removedAttachmentKeys: "nope" })).toEqual(
      [],
    );
  });

  it("skips non-object entries instead of throwing on identity projection", () => {
    const kept = resolveKeptAttachments({ attachments: [attachment("a"), null, "x", []] }, {});
    expect(kept.map((item) => item.attachmentId)).toEqual(["a"]);
  });
});
