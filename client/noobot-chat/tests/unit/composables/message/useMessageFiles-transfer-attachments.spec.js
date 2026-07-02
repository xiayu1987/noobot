import { describe, expect, it } from "vitest";
import { createMessageFiles } from "./helpers/useMessageFiles-helper";

describe("useMessageFiles transfer attachments", () => {
  it("keeps legacy attachment metadata while augmenting display with semantic-transfer fields", () => {
    const envelope = {
      protocol: "noobot.semantic-transfer",
      version: 1,
      direction: "output",
      transport: "file",
      filePath: "/workspace/admin/runtime/result.md",
      files: [
        {
          filePath: "/workspace/admin/runtime/result.md",
          attachmentMeta: {
            attachmentId: "att-transfer-1",
            name: "result.md",
            mimeType: "text/markdown",
            path: "/legacy/result.md",
          },
          pathView: { sandboxPath: "/workspace/admin/runtime/result.md" },
          role: "primary",
        },
      ],
    };
    const messageItem = {
      role: "assistant",
      dialogProcessId: "dp-1",
      content: "done",
      attachments: [
        {
          attachmentId: "att-transfer-1",
          name: "legacy-result.md",
          mimeType: "text/plain",
          path: "/legacy-only/result.md",
        },
      ],
      transferEnvelopes: [envelope],
    };
    const { displayedAttachments } = createMessageFiles({
      getMessageItem: () => messageItem,
      getAllMessages: () => [],
      getSessionDocs: () => [],
      getUserId: () => "admin",
    });

    expect(displayedAttachments.value).toHaveLength(1);
    expect(displayedAttachments.value[0]).toMatchObject({
      attachmentId: "att-transfer-1",
      name: "legacy-result.md",
      mimeType: "text/plain",
      transferFilePath: "/workspace/admin/runtime/result.md",
      owner: { type: "agent" },
    });
  });
});
