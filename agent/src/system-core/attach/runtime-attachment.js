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

function appendUniqueTransferEnvelope(target = [], envelope = null, seen = new Set()) {
  if (!envelope || typeof envelope !== "object" || Array.isArray(envelope)) return;
  const key = JSON.stringify(envelope);
  if (seen.has(key)) return;
  seen.add(key);
  target.push(envelope);
}

/**
 * 将附件元数据追加到运行时上下文和当前 turn 中
 */
export function appendAttachmentMetasToRuntimeAndTurn(
  runtimeOrPayload,
  turnArg,
  attachmentsArg = [],
  optionsArg = {},
) {
  const isPayloadStyle =
    runtimeOrPayload &&
    typeof runtimeOrPayload === "object" &&
    (Object.prototype.hasOwnProperty.call(runtimeOrPayload, "runtime") ||
      Object.prototype.hasOwnProperty.call(runtimeOrPayload, "turnMessageStore") ||
      Object.prototype.hasOwnProperty.call(runtimeOrPayload, "attachments"));

  const runtime = isPayloadStyle ? runtimeOrPayload.runtime : runtimeOrPayload;
  const turn = isPayloadStyle
    ? runtimeOrPayload.turnMessageStore || runtimeOrPayload.turn
    : turnArg;
  const attachmentMetas = isPayloadStyle
    ? runtimeOrPayload.attachments || []
    : attachmentsArg;
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

  // 更新 runtime。标准字段统一为 attachments。
  runtime.attachments = mergeAttachmentMetas(
    Array.isArray(runtime.attachments) ? runtime.attachments : [],
    mappedMetas,
  );

  const applyAttachmentPayload = (target = {}) => {
    const mergedEnvelopes = [];
    const seenEnvelopeKeys = new Set();
    if (Array.isArray(target?.transferEnvelopes)) {
      for (const envelope of target.transferEnvelopes) {
        appendUniqueTransferEnvelope(mergedEnvelopes, envelope, seenEnvelopeKeys);
      }
    }
    if (Array.isArray(transferPayload.transferEnvelopes)) {
      for (const envelope of transferPayload.transferEnvelopes) {
        appendUniqueTransferEnvelope(mergedEnvelopes, envelope, seenEnvelopeKeys);
      }
    }
    return {
      ...(target || {}),
      ...(mergedEnvelopes.length ? { transferEnvelopes: mergedEnvelopes } : {}),
      ...(ordinaryAttachmentMetas.length
        ? {
            attachments: mergeAttachmentMetas(
              Array.isArray(target?.attachments) ? target.attachments : [],
              ordinaryAttachmentMetas,
            ),
          }
        : { attachments: undefined }),
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
    const nextItem = applyAttachmentPayload(lastItem);
    if (!ordinaryAttachmentMetas.length) delete nextItem.attachments;
    turn.updateLast(nextItem);
    return;
  }
  if (Array.isArray(turn)) {
    if (!turn.length) return;
    const lastIndex = turn.length - 1;
    const lastItem = turn[lastIndex] || {};
    turn[lastIndex] = applyAttachmentPayload(lastItem);
    if (!ordinaryAttachmentMetas.length) delete turn[lastIndex].attachments;
    return;
  }
  Object.assign(turn, applyAttachmentPayload(turn));
  if (!ordinaryAttachmentMetas.length) delete turn.attachments;
}
