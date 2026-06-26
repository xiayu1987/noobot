import { describe, expect, it } from "vitest";
import {
  getMessageTransferAttachments,
  getMessageTransferEnvelopes,
  getTransferDisplayPath,
  normalizeTransferEnvelope,
} from "../../../../src/composables/infra/transferEnvelopes";

const envelope = {
  protocol: "noobot.semantic-transfer",
  version: 1,
  direction: "output",
  transport: "file",
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

describe("transferEnvelopes", () => {
  it("normalizes semantic-transfer envelopes only", () => {
    expect(normalizeTransferEnvelope(envelope)).toBe(envelope);
    expect(normalizeTransferEnvelope({ protocol: "legacy" })).toBeNull();
  });

  it("extracts attachment-like metas from transfer files", () => {
    const metas = getMessageTransferAttachments({ transferEnvelopes: [envelope] });

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

  it("extracts compact session-summary transfer file refs", () => {
    const metas = getMessageTransferAttachments({
      transferEnvelopes: [
        {
          protocol: "noobot.semantic-transfer",
          version: 1,
          direction: "output",
          transport: "file",
          files: [
            {
              attachmentId: "att-compact-1",
              name: "compact.md",
              mimeType: "text/markdown",
              relativePath: "runtime/compact.md",
              sandboxPath: "/workspace/u1/runtime/compact.md",
              owner: { type: "plugin", id: "harness-plugin" },
              role: "primary",
            },
          ],
        },
      ],
    });

    expect(metas).toHaveLength(1);
    expect(metas[0]).toMatchObject({
      attachmentId: "att-compact-1",
      name: "compact.md",
      mimeType: "text/markdown",
      relativePath: "runtime/compact.md",
      sandboxPath: "/workspace/u1/runtime/compact.md",
      transferFilePath: "/workspace/u1/runtime/compact.md",
      owner: { type: "plugin", id: "harness-plugin" },
      transferRole: "primary",
    });
  });

  it("ignores legacy shortcut fields when files are absent", () => {
    const metas = getMessageTransferAttachments({
      transferEnvelopes: [
        {
          protocol: "noobot.semantic-transfer",
          version: 1,
          direction: "output",
          transport: "file",
          filePath: "/workspace/user/out/legacy.txt",
          attachmentMeta: { name: "legacy.txt", mimeType: "text/plain" },
        },
      ],
    });

    expect(metas).toEqual([]);
  });

  it("collects envelopes only from transferEnvelopes", () => {
    const envelopes = getMessageTransferEnvelopes({
      transferEnvelopes: [envelope],
    });

    expect(envelopes).toEqual([envelope]);
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
