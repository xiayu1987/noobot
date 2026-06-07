/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { mergeAttachmentMetas, mapAttachmentRecordsToMetas } from "./meta-ops.js";
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

  // 更新 runtime
  runtime.attachmentMetas = mergeAttachmentMetas(
    runtime.attachmentMetas,
    mappedMetas,
  );

  // 更新 turn（支持当前 turn store / 普通对象 / 数组）
  const isTurnStore =
    turn &&
    typeof turn === "object" &&
    typeof turn.updateLast === "function";
  if (isTurnStore) {
    let existingAttachmentMetas = [];
    if (typeof turn.toArray === "function") {
      const turnItems = turn.toArray();
      const lastItem = Array.isArray(turnItems)
        ? turnItems[turnItems.length - 1] || {}
        : {};
      existingAttachmentMetas = Array.isArray(lastItem?.attachmentMetas)
        ? lastItem.attachmentMetas
        : [];
    }
    const mergedAttachmentMetas = mergeAttachmentMetas(
      existingAttachmentMetas,
      mappedMetas,
    );
    turn.updateLast({
      attachmentMetas: mergedAttachmentMetas,
    });
    return;
  }
  if (Array.isArray(turn)) {
    if (!turn.length) return;
    const lastIndex = turn.length - 1;
    const lastItem = turn[lastIndex] || {};
    turn[lastIndex] = {
      ...lastItem,
      attachmentMetas: mergeAttachmentMetas(lastItem?.attachmentMetas, mappedMetas),
    };
    return;
  }
  turn.attachmentMetas = mergeAttachmentMetas(turn.attachmentMetas, mappedMetas);
}
