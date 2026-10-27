/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { describe, expect, it, vi } from "vitest";
import { ref } from "vue";
import { AGENT_COMMAND } from "@noobot/agent-transport-protocol";
import { resolveSendRequest } from "../../../../../../src/modules/chat/runtime/engine/sendRequestResolver.js";

const UPLOAD_HINT = "upload-hint";

function createDeps({ inputText = "", uploadFiles = [], messages = [] } = {}) {
  return {
    activeSession: ref({ sessionId: "session-1", messages }),
    ensureConnected: vi.fn(() => true),
    input: ref(inputText),
    uploadFiles: ref(uploadFiles),
    translate: vi.fn((key) => (key === "chat.uploadHint" ? UPLOAD_HINT : key)),
  };
}

describe("resolveSendRequest message text", () => {
  it("keeps authored composer text as the single message text", () => {
    const request = resolveSendRequest(
      { commandType: AGENT_COMMAND.SEND },
      createDeps({ inputText: "  hello  " }),
    );
    expect(request.authoredText).toBe("hello");
    expect(request.messageText).toBe("hello");
  });

  it("resolves attachment-only composer input to the upload hint without authored text", () => {
    const request = resolveSendRequest(
      { commandType: AGENT_COMMAND.SEND },
      createDeps({ uploadFiles: [{ clientAttachmentId: "draft-1" }] }),
    );
    expect(request.authoredText).toBe("");
    expect(request.messageText).toBe(UPLOAD_HINT);
  });

  it("rejects an empty composer send without attachments", () => {
    expect(resolveSendRequest({ commandType: AGENT_COMMAND.SEND }, createDeps())).toBeNull();
  });

  it("trims resend text and resolves attachment-only resend to the upload hint", () => {
    const deps = createDeps({ messages: [{ userMessageId: "msg_user-1" }] });
    const base = {
      commandType: AGENT_COMMAND.RESEND,
      userMessageId: "msg_user-1",
      turnScopeId: "turn-1",
      dialogProcessId: "dlg-1",
      attachments: [{ attachmentId: "att-1" }],
    };
    const edited = resolveSendRequest({ ...base, messageText: "  edited  " }, deps);
    expect(edited.authoredText).toBe("edited");
    expect(edited.messageText).toBe("edited");
    const attachmentOnly = resolveSendRequest({ ...base, messageText: "   " }, deps);
    expect(attachmentOnly.authoredText).toBe("");
    expect(attachmentOnly.messageText).toBe(UPLOAD_HINT);
  });
});
