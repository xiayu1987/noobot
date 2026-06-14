/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import {
  buildTransferPayloadFromAttachmentMetas,
  filterSemanticTransferAttachmentMetas,
  mergeAttachmentMetas,
  mapAttachmentRecordsToMetas,
} from "./meta-ops.js";
import { DEFAULT_MIME_TYPE } from "./constants.js";

/**
 * 将附件元数据追加到运行时上下文和当前 turn 中
 */
export function appendAttachmentMetasToRuntimeAndTurn(
  runtimeOrPayload,
  turnArg,
  attachmentMetasArg = [],
  optionsArg = {},
) {
  const isPayloadStyle =
    runtimeOrPayload &&
    typeof runtimeOrPayload === "object" &&
    (Object.prototype.hasOwnProperty.call(runtimeOrPayload, "runtime") ||
      Object.prototype.hasOwnProperty.call(runtimeOrPayload, "turnMessageStore") ||
      Object.prototype.hasOwnProperty.call(runtimeOrPayload, "attachmentMetas"));

  const runtime = isPayloadStyle ? runtimeOrPayload.runtime : runtimeOrPayload;
  const turn = isPayloadStyle
    ? runtimeOrPayload.turnMessageStore || runtimeOrPayload.turn
    : turnArg;
  const attachmentMetas = isPayloadStyle
    ? runtimeOrPayload.attachmentMetas || []
    : attachmentMetasArg;
  const options = isPayloadStyle ? runtimeOrPayload.options || {} : optionsArg;

  const {
    fallbackMimeType = DEFAULT_MIME_TYPE,
    fallbackGenerationSource = "",
  } = options;

  if (!runtime || !turn) return;

  const mappedMetas = mapAttachmentRecordsToMetas(attachmentMetas, {
    fallbackMimeType,
    fallbackGenerationSource,
  });

  if (mappedMetas.length === 0) return;
  const semanticTransferMetas = filterSemanticTransferAttachmentMetas(mappedMetas);
  const ordinaryAttachmentMetas = mappedMetas.filter(
    (item) => !semanticTransferMetas.includes(item),
  );
  const transferPayload = buildTransferPayloadFromAttachmentMetas(semanticTransferMetas);

  // 更新 runtime
  runtime.attachmentMetas = mergeAttachmentMetas(
    runtime.attachmentMetas,
    mappedMetas,
  );

  const applyAttachmentPayload = (target = {}) => {
    const existingEnvelope = target?.transferEnvelope && typeof target.transferEnvelope === "object"
      ? target.transferEnvelope
      : target?.transferResult?.envelope && typeof target.transferResult.envelope === "object"
        ? target.transferResult.envelope
        : null;
    const existingEnvelopes = Array.isArray(target?.transferEnvelopes)
      ? target.transferEnvelopes
      : existingEnvelope
        ? [existingEnvelope]
        : [];
    const mergedEnvelopes = [...existingEnvelopes, ...transferPayload.transferEnvelopes];
    const primaryEnvelope = existingEnvelope || transferPayload.transferEnvelope || mergedEnvelopes[0] || null;
    return {
      ...(target || {}),
      ...(target?.transferResult
        ? { transferResult: target.transferResult }
        : transferPayload.transferResult
          ? { transferResult: transferPayload.transferResult }
          : {}),
      ...(primaryEnvelope ? { transferEnvelope: primaryEnvelope } : {}),
      ...(mergedEnvelopes.length ? { transferEnvelopes: mergedEnvelopes } : {}),
      ...(ordinaryAttachmentMetas.length
        ? {
            attachmentMetas: mergeAttachmentMetas(
              Array.isArray(target?.attachmentMetas) ? target.attachmentMetas : [],
              ordinaryAttachmentMetas,
            ),
          }
        : { attachmentMetas: undefined }),
    };
  };

  // 更新 turn（支持当前 turn store / 普通对象 / 数组）
  const isTurnStore =
    turn &&
    typeof turn === "object" &&
    typeof turn.updateLast === "function";
  if (isTurnStore) {
    const turnItems = typeof turn.toArray === "function" ? turn.toArray() : [];
    const lastItem = Array.isArray(turnItems) && turnItems.length
      ? turnItems[turnItems.length - 1] || {}
      : {};
    turn.updateLast(applyAttachmentPayload(lastItem));
    return;
  }
  if (Array.isArray(turn)) {
    if (!turn.length) return;
    const lastIndex = turn.length - 1;
    const lastItem = turn[lastIndex] || {};
    turn[lastIndex] = applyAttachmentPayload(lastItem);
    if (!ordinaryAttachmentMetas.length) delete turn[lastIndex].attachmentMetas;
    return;
  }
  Object.assign(turn, applyAttachmentPayload(turn));
  if (!ordinaryAttachmentMetas.length) delete turn.attachmentMetas;
}
