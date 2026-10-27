/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { describe, expect, it } from "vitest";
import { attachmentIdentityKey, projectAttachmentIdentity } from "@noobot/attachment-protocol";
import { resolveKeptAttachments } from "../../../../../../src/modules/chat/runtime/engine/resendTransaction.js";
import { NO_ATTACHMENT_EDITS } from "../../../../helpers/resendEdits.js";

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
    const kept = resolveKeptAttachments(
      { attachments: [attachment("a"), attachment("b")] },
      NO_ATTACHMENT_EDITS,
    );
    expect(kept.map((item) => item.attachmentId)).toEqual(["a", "b"]);
  });

  it("drops attachments whose identity key is listed as removed", () => {
    const removed = attachment("b");
    const kept = resolveKeptAttachments(
      { attachments: [attachment("a"), removed, attachment("c")] },
      { ...NO_ATTACHMENT_EDITS, removedAttachmentKeys: [identityKeyOf(removed)] },
    );
    expect(kept.map((item) => item.attachmentId)).toEqual(["a", "c"]);
  });

  it("merges option attachments and deduplicates by identity", () => {
    const shared = attachment("a");
    const kept = resolveKeptAttachments(
      { attachments: [shared] },
      { ...NO_ATTACHMENT_EDITS, attachments: [shared, attachment("b")] },
    );
    expect(kept.map((item) => item.attachmentId)).toEqual(["a", "b"]);
  });

  it("strips raw and file carriers from returned metadata", () => {
    const kept = resolveKeptAttachments(
      { attachments: [attachment("a", { raw: { blob: 1 }, file: { name: "a.txt" } })] },
      NO_ATTACHMENT_EDITS,
    );
    expect(kept[0]).not.toHaveProperty("raw");
    expect(kept[0]).not.toHaveProperty("file");
    expect(kept[0].fileName).toBe("a.txt");
  });

  it("rejects an edit payload without the attachment edit arrays", () => {
    expect(() => resolveKeptAttachments({ attachments: [attachment("a")] }, {})).toThrow(TypeError);
  });
});
