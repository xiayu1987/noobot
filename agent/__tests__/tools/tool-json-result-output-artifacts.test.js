/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  buildToolResultPayload,
  parseToolOutputArtifacts,
  projectToolResultForModel,
} from "../../src/tools/core/tool-json-result.js";
import { attachmentTransfer, createTransferIdentity } from "@noobot/semantic-transfer-protocol";

test("failed tool results use one required result shape", () => {
  assert.deepEqual(buildToolResultPayload({ ok: false, message: "blocked" }), {
    ok: false,
    message: "blocked",
    status: "failed",
    error: "blocked",
    code: "RECOVERABLE_TOOL_ERROR",
  });
  assert.deepEqual(
    buildToolResultPayload({
      ok: false,
      status: "denied",
      error: "out of scope",
      code: "RECOVERABLE_PATH_OUT_OF_SCOPE",
    }),
    {
      ok: false,
      status: "denied",
      error: "out of scope",
      code: "RECOVERABLE_PATH_OUT_OF_SCOPE",
    },
  );
  assert.deepEqual(
    buildToolResultPayload({
      ok: false,
      code: 1,
      stderr: "path is outside the declared input scope\n",
    }),
    {
      ok: false,
      status: "failed",
      error: "path is outside the declared input scope",
      code: 1,
      stderr: "path is outside the declared input scope\n",
    },
  );
});

test("output artifact types have one strict representation", () => {
  assert.deepEqual(
    parseToolOutputArtifacts({
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
    messageId: "message-1",
    identity: transferIdentity,
    direction: "output",
    intent: {
      source: "tool",
      reason: "result",
      scenario: "tool",
      strategy: "tool_output",
    },
    attachments: [{ identity, name: "result.txt" }],
  });

  assert.deepEqual(
    JSON.parse(
      projectToolResultForModel(
        JSON.stringify({
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
        JSON.stringify({ ...identity, attachmentRef: "attachment:v1:other/model/att-1" }),
      ),
    /mixed_attachment_identity_representations/,
  );
  assert.throws(
    () =>
      projectToolResultForModel(
        JSON.stringify({ identity, attachmentRef: "attachment:v1:other/model/att-1" }),
      ),
    /mixed_attachment_identity_representations/,
  );
  assert.throws(
    () => projectToolResultForModel(JSON.stringify({ transferEnvelopes: [], attachmentRefs: [] })),
    /mixed_attachment_transfer_representations/,
  );
  assert.throws(
    () => projectToolResultForModel(JSON.stringify({ attachmentId: "att-1" })),
    /incomplete_attachment_identity/,
  );
});

test("model tool results preserve non-attachment session identities", () => {
  assert.deepEqual(
    JSON.parse(
      projectToolResultForModel(
        JSON.stringify({
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
