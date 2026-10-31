/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  parseToolOutputArtifacts,
  projectToolResultForModel,
  toToolJsonResult,
} from "../../src/tools/core/tool-json-result.js";
import {
  attachmentTransfer,
  createTransferIdentity,
  sourceReferenceTransfer,
  TRANSFER_REASON,
} from "@noobot/semantic-transfer-protocol";

test("toToolJsonResult encodes protocol-valid results without filling values", () => {
  const failure = {
    ok: false,
    status: "denied",
    error: "out of scope",
    code: "RECOVERABLE_PATH_OUT_OF_SCOPE",
  };
  assert.equal(
    toToolJsonResult("read_file", failure),
    JSON.stringify({ toolName: "read_file", ...failure }),
  );
});

test("toToolJsonResult rejects results that violate the tool result protocol", () => {
  assert.throws(() => toToolJsonResult("read_file", { ok: false, message: "blocked" }));
  assert.throws(() => toToolJsonResult("read_file", { ok: false, error: "x", code: 1 }));
  assert.throws(() => toToolJsonResult("read_file", { ok: "yes" }));
  assert.throws(() => toToolJsonResult("read_file", "plain"));
  assert.throws(() => toToolJsonResult("", { ok: true }), TypeError);
});

test("output artifact types have one strict representation", () => {
  assert.deepEqual(
    parseToolOutputArtifacts({
      ok: true,
      outputArtifacts: [
        {
          type: "attachment_url",
          name: "image-url.txt",
          mimeType: "text/plain",
          content: "https://example.test/image.png",
        },
      ],
    })[0],
    {
      type: "attachment_url",
      name: "image-url.txt",
      mimeType: "text/plain",
      content: "https://example.test/image.png",
    },
  );

  assert.deepEqual(
    parseToolOutputArtifacts({
      ok: true,
      outputArtifacts: [
        {
          type: "attachment_bytes",
          name: "image.png",
          mimeType: "image/png",
          contentBase64: "AQID",
        },
      ],
    })[0].type,
    "attachment_bytes",
  );

  assert.deepEqual(
    parseToolOutputArtifacts({
      ok: true,
      outputArtifacts: [
        {
          type: "attachment_bytes",
          name: "empty.bin",
          mimeType: "application/octet-stream",
          contentBase64: "",
        },
      ],
    })[0],
    {
      type: "attachment_bytes",
      name: "empty.bin",
      mimeType: "application/octet-stream",
      contentBase64: "",
    },
  );

  assert.throws(
    () =>
      parseToolOutputArtifacts({
        ok: true,
        outputArtifacts: [
          {
            type: "attachment_bytes",
            name: "image.png",
            mimeType: "image/png",
            contentBase64: "not-base64",
          },
        ],
      }),
    /invalid_tool_output_artifact_bytes/,
  );
  assert.throws(
    () =>
      parseToolOutputArtifacts({
        ok: true,
        outputArtifacts: [
          {
            name: "missing-type.txt",
            mimeType: "text/plain",
            content: "x",
          },
        ],
      }),
    /invalid_tool_output_artifact_type/,
  );
});

test("model tool results expose only canonical attachment references", () => {
  const identity = {
    attachmentId: "att-1",
    sessionId: "session-1",
    attachmentSource: "model",
  };
  const transferIdentity = createTransferIdentity({
    sessionId: "session-1",
    turnScopeId: "turn-1",
    runId: "run-1",
    producer: { type: "tool", id: "call-1" },
  });
  const transferEnvelope = attachmentTransfer({
    transferId: "transfer-1",
    presentationMessageId: "message-1",
    identity: transferIdentity,
    direction: "output",
    intent: {
      source: "tool",
      reason: TRANSFER_REASON.SEMANTIC_TRANSFER_TOOL_RESULT,
      scenario: "tool",
      strategy: "tool_output",
    },
    attachments: [{ identity, name: "result.txt" }],
  });

  assert.deepEqual(
    JSON.parse(
      projectToolResultForModel(
        JSON.stringify({
          ok: true,
          path: { view: "attachment", identity },
          attachments: [
            {
              ...identity,
              name: "result.txt",
              mimeType: "text/plain",
              size: 0,
              path: "/internal/result.txt",
              sandboxPath: "/sandbox/result.txt",
            },
          ],
          transferEnvelopes: [transferEnvelope],
          resources: [{ resourceId: "internal" }],
        }),
      ),
    ),
    {
      ok: true,
      path: {
        view: "attachment",
        attachmentRef: "attachment:v1:session-1/model/att-1",
      },
      attachments: [
        {
          attachmentRef: "attachment:v1:session-1/model/att-1",
          name: "result.txt",
          mimeType: "text/plain",
          size: 0,
        },
      ],
      attachmentRefs: ["attachment:v1:session-1/model/att-1"],
    },
  );
});

test("model tool results reject mixed attachment representations", () => {
  const identity = {
    attachmentId: "att-1",
    sessionId: "session-1",
    attachmentSource: "model",
  };
  assert.throws(
    () =>
      projectToolResultForModel(
        JSON.stringify({ ok: true, ...identity, attachmentRef: "attachment:v1:other/model/att-1" }),
      ),
    /mixed_attachment_identity_representations/,
  );
  assert.throws(
    () =>
      projectToolResultForModel(
        JSON.stringify({ ok: true, identity, attachmentRef: "attachment:v1:other/model/att-1" }),
      ),
    /mixed_attachment_identity_representations/,
  );
  assert.throws(
    () =>
      projectToolResultForModel(
        JSON.stringify({ ok: true, transferEnvelopes: [], attachmentRefs: [] }),
      ),
    /mixed_attachment_transfer_representations/,
  );
  assert.throws(
    () => projectToolResultForModel(JSON.stringify({ ok: true, attachmentId: "att-1" })),
    /incomplete_attachment_identity/,
  );
});

test("model tool results preserve non-attachment session identities", () => {
  assert.deepEqual(
    JSON.parse(
      projectToolResultForModel(
        JSON.stringify({
          ok: true,
          sessionId: "session-1",
          parentSessionId: "session-root",
          identity: {
            sessionId: "session-1",
            turnScopeId: "turn-1",
            runId: "run-1",
          },
        }),
      ),
    ),
    {
      ok: true,
      sessionId: "session-1",
      parentSessionId: "session-root",
      identity: {
        sessionId: "session-1",
        turnScopeId: "turn-1",
        runId: "run-1",
      },
    },
  );
});

test("projectToolResultForModel exposes source reference envelopes to the model", () => {
  const transferIdentity = createTransferIdentity({
    sessionId: "session-1",
    turnScopeId: "turn-1",
    runId: "run-1",
    producer: { type: "tool", id: "call-1" },
  });
  const intent = {
    source: "tool",
    reason: TRANSFER_REASON.SEMANTIC_TRANSFER_TOOL_RESULT,
    scenario: "tool",
    strategy: "tool_output",
  };
  const fileEnvelope = sourceReferenceTransfer({
    transferId: "transfer-file",
    presentationMessageId: "message-1",
    identity: transferIdentity,
    direction: "output",
    intent,
    reference: {
      address: "/ws/big.txt",
      name: "big.txt",
      startLine: 1,
      endLine: 400,
      totalLines: 20000,
    },
  });
  const attachmentEnvelope = sourceReferenceTransfer({
    transferId: "transfer-attachment",
    presentationMessageId: "message-1",
    identity: transferIdentity,
    direction: "output",
    intent,
    reference: {
      address: { attachmentId: "att-1", sessionId: "session-1", attachmentSource: "model" },
      name: "r.txt",
      startLine: 1,
      endLine: 10,
      totalLines: 10,
    },
  });
  assert.deepEqual(
    JSON.parse(
      projectToolResultForModel(
        JSON.stringify({ ok: true, transferEnvelopes: [fileEnvelope, attachmentEnvelope] }),
      ),
    ),
    {
      ok: true,
      sourceReferences: [
        { filePath: "/ws/big.txt", startLine: 1, endLine: 400, totalLines: 20000 },
        {
          attachmentRef: "attachment:v1:session-1/model/att-1",
          startLine: 1,
          endLine: 10,
          totalLines: 10,
        },
      ],
    },
  );
});
