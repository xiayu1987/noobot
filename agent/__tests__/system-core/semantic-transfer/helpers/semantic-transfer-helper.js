/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  COMPACT_TRANSFER_FILE_FIELDS,
  COMPACT_TRANSFER_PAYLOAD_FIELDS,
  compactToolResultTextForModel,
  directInput,
  directOutput,
  extractTransferEnvelopeFromPersisted,
  fileOutput,
  isTransferEnvelope,
  normalizeTransferEnvelopes,
  normalizeTransferEnvelopesWithPolicy,
  normalizeTransferReason,
  normalizeTransferSource,
  normalizeTransfer,
  resolveTransferIntent,
  resolveTransferFilePath,
  transferSemanticContent,
  resolveTransferPathView,
} from "../../../../src/system-core/semantic-transfer/index.js";
import { LENGTH_THRESHOLDS } from "@noobot/shared/length-thresholds";
import { materializeOutput } from "../../../../src/system-core/semantic-transfer/storage/materializer.js";

const TOOL_INPUT_OVERFLOW_CHARS = LENGTH_THRESHOLDS.semanticTransfer.toolInputOverflowChars;

function assertTransferProtocolOnly(assert, value = {}) {
  assert.deepEqual(Object.keys(value).sort(), ["transferEnvelopes"]);
}

function firstTransferFile(value = {}) {
  return value?.transferEnvelopes?.[0]?.files?.[0] || {};
}

function buildSandboxRuntime(enabled = true, overrides = {}) {
  return {
    userId: "primary-user",
    basePath: "/host/users/primary-user",
    globalConfig: {
      tools: {
        execute_script: {
          sandboxMode: enabled === true,
          sandboxProvider: {
            default: "docker",
            docker: { dockerContainerScope: "global" },
          },
        },
      },
    },
    userConfig: {},
    ...overrides,
  };
}

export {
  COMPACT_TRANSFER_FILE_FIELDS,
  COMPACT_TRANSFER_PAYLOAD_FIELDS,
  TOOL_INPUT_OVERFLOW_CHARS,
  assertTransferProtocolOnly,
  buildSandboxRuntime,
  compactToolResultTextForModel,
  directInput,
  directOutput,
  extractTransferEnvelopeFromPersisted,
  fileOutput,
  firstTransferFile,
  isTransferEnvelope,
  materializeOutput,
  normalizeTransfer,
  normalizeTransferEnvelopes,
  normalizeTransferEnvelopesWithPolicy,
  normalizeTransferReason,
  normalizeTransferSource,
  resolveTransferFilePath,
  resolveTransferIntent,
  resolveTransferPathView,
  transferSemanticContent,
};
