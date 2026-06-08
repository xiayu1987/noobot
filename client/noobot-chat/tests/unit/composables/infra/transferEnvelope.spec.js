import { describe, expect, it } from "vitest";
import {
  getMessageTransferAttachmentMetas,
  getMessageTransferEnvelopes,
  getTransferDisplayPath,
  normalizeTransferEnvelope,
} from "../../../../src/composables/infra/transferEnvelope";

const envelope = {
  protocol: "noobot.semantic-transfer",
  version: 1,
  direction: "output",
  transport: "file",
  filePath: "/workspace/user/out/report.md",
  files: [
    {
      filePath: "/workspace/user/out/report.md",
      attachmentMeta: {
        attachmentId: "att-1",
        name: "report.md",
        mimeType: "text/markdown",
        relativePath: "attachments/report.md",
      },
      pathView: {
        displayPath: "/workspace/user/out/report.md",
        sandboxPath: "/sandbox/out/report.md",
        relativePath: "attachments/report.md",
      },
      role: "primary",
    },
  ],
};

describe("transferEnvelope", () => {
  it("normalizes semantic-transfer envelopes only", () => {
    expect(normalizeTransferEnvelope(envelope)).toBe(envelope);
    expect(normalizeTransferEnvelope({ protocol: "legacy" })).toBeNull();
  });

  it("extracts attachment-like metas from transfer files", () => {
    const metas = getMessageTransferAttachmentMetas({ transferEnvelope: envelope });

    expect(metas).toHaveLength(1);
    expect(metas[0]).toMatchObject({
      attachmentId: "att-1",
      name: "report.md",
      mimeType: "text/markdown",
      relativePath: "attachments/report.md",
      sandboxPath: "/sandbox/out/report.md",
      transferFilePath: "/workspace/user/out/report.md",
      transferRole: "primary",
    });
  });

  it("uses legacy shortcut fields when files are absent", () => {
    const metas = getMessageTransferAttachmentMetas({
      transferEnvelope: {
        protocol: "noobot.semantic-transfer",
        version: 1,
        direction: "output",
        transport: "file",
        filePath: "/workspace/user/out/legacy.txt",
        attachmentMeta: { name: "legacy.txt", mimeType: "text/plain" },
      },
    });

    expect(metas[0]).toMatchObject({
      name: "legacy.txt",
      mimeType: "text/plain",
      transferFilePath: "/workspace/user/out/legacy.txt",
    });
  });

  it("collects envelopes from direct, array, and result fields", () => {
    const envelopes = getMessageTransferEnvelopes({
      transferEnvelope: envelope,
      transferEnvelopes: [envelope],
      transferResult: { envelope },
    });

    expect(envelopes).toHaveLength(3);
  });

  it("resolves display path by semantic path view precedence", () => {
    expect(
      getTransferDisplayPath({
        filePath: "/host/file.txt",
        pathView: { displayPath: "/display/file.txt" },
      }),
    ).toBe("/display/file.txt");
  });
});
