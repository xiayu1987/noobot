/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  attachmentTransfer,
  assertTransferEnvelope,
  createAttachmentReference,
  createTransferEnvelope,
  createTransferIdentity,
  directTransfer,
  TRANSFER_DIRECTION,
  validateTransferEnvelope,
} from "@noobot/semantic-transfer-protocol";
import {
  COMPACT_TRANSFER_FILE_FIELDS,
  COMPACT_TRANSFER_PAYLOAD_FIELDS,
  compactToolResultTextForModel,
} from "../../../src/transfer-adapter/core/compact.js";
import { transferSemanticContent } from "../../../src/transfer-adapter/transfer/semantic-transfer.js";
import {
  materializeOutput,
  materializeOutputResult,
} from "../../../src/transfer-adapter/storage/materializer.js";
import {
  persistTransferArtifacts,
  persistTransferFile,
} from "../../../src/transfer-adapter/storage/attachment-adapter.js";
import {
  getTransferAttachments,
  getPrimaryTransferAttachment,
  getTransferAttachmentIdentities,
  getTransferEnvelopes,
} from "../../../src/transfer-adapter/storage/consumer.js";
import { LENGTH_THRESHOLDS } from "@noobot/shared/length-thresholds";

export const TOOL_INPUT_OVERFLOW_CHARS = LENGTH_THRESHOLDS.semanticTransfer.toolInputOverflowChars;
export const BASE_IDENTITY = Object.freeze({
  transferId: "transfer-test-1",
  messageId: "message-test-1",
  sessionId: "session-test-1",
  turnScopeId: "turn-test-1",
  runId: "run-test-1",
  producer: { type: "test", id: "producer-test-1" },
});

export function identity(overrides = {}) {
  return {
    ...BASE_IDENTITY,
    ...overrides,
    producer: { ...BASE_IDENTITY.producer, ...(overrides.producer || {}) },
  };
}

export function assertTransferProtocolOnly(assert, value = {}) {
  assert.deepEqual(Object.keys(value).sort(), ["transferEnvelopes"]);
}

export function firstTransferAttachment(value = {}) {
  return getPrimaryTransferAttachment(value);
}

export const firstTransferFile = firstTransferAttachment;

export function buildSandboxRuntime(enabled = true, overrides = {}) {
  return {
    userId: "primary-user",
    globalConfig: {
      security: {
        executionIsolation: {
          mode: enabled ? "sandbox" : "host",
          sandbox: { provider: "docker", scope: "user" },
        },
      },
    },
    userConfig: {},
    ...overrides,
  };
}

export function isValidTransferEnvelope(value) {
  return validateTransferEnvelope(value).ok;
}

export {
  COMPACT_TRANSFER_FILE_FIELDS,
  COMPACT_TRANSFER_PAYLOAD_FIELDS,
  attachmentTransfer,
  assertTransferEnvelope,
  compactToolResultTextForModel,
  createAttachmentReference,
  createTransferEnvelope,
  createTransferIdentity,
  directTransfer,
  getTransferAttachmentIdentities,
  getTransferAttachments,
  getTransferEnvelopes,
  materializeOutput,
  materializeOutputResult,
  persistTransferArtifacts,
  persistTransferFile,
  transferSemanticContent,
  validateTransferEnvelope,
  TRANSFER_DIRECTION,
};
