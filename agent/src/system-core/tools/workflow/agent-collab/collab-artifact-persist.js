/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { Buffer } from "node:buffer";
import { logError } from "../../../tracking/console/logger.js";
import { persistTransferArtifacts } from "../../../semantic-transfer/index.js";
import { TASK_STATUS } from "../../../bot-manage/async/constants.js";
import { MIME_TYPE } from "../../../constants/index.js";
import { normalizeString } from "./collab-task-utils.js";

function toSafeArtifactName(value = "") {
  return String(value || "")
    .replace(/[\\/:*?"<>|]+/g, "_")
    .replace(/\s+/g, "_")
    .slice(0, 80);
}

function toFinalResultMarkdownText({ taskResultItem = {}, tAgentCollab, runtime } = {}) {
  const rawResult = taskResultItem?.rawResult ?? taskResultItem?.result ?? null;
  const answer = String(rawResult?.answer || "").trim();
  if (answer) return answer;
  if (typeof rawResult === "string") return String(rawResult || "").trim();
  if (rawResult && typeof rawResult === "object") {
    try {
      return JSON.stringify(rawResult, null, 2);
    } catch (error) {
      logError("[agent-collab-tool] JSON.stringify task result failed", {
        error: error?.message || String(error),
      });
    }
  }
  const fallbackError = String(taskResultItem?.error || "").trim();
  if (fallbackError) return fallbackError;
  return String(taskResultItem?.status || "").trim() || tAgentCollab(runtime, "noResult");
}

export function createCollabArtifactPersistor({
  runtime,
  rootSessionId,
  userId,
  attachmentService,
  patchAsyncResultTask,
  tAgentCollab,
}) {
  const emptyPersistOutput = {
    attachmentMetas: [],
    transferResult: null,
    transferEnvelope: null,
    transferEnvelopes: [],
  };
  return async function persistCompletedTaskResultsAsAttachments({
    container = {},
    taskResults = [],
  } = {}) {
    if (!attachmentService || !userId) return emptyPersistOutput;
    const parentSessionId = String(container?.parentSessionId || "").trim();
    const attachmentSessionId = String(
      runtime?.systemRuntime?.sessionId ||
        runtime?.systemRuntime?.rootSessionId ||
        rootSessionId ||
        parentSessionId ||
        "",
    ).trim();
    if (!attachmentSessionId) return emptyPersistOutput;

    const taskList = Array.isArray(container?.tasks) ? container.tasks : [];
    const attachedSessionIdSet = new Set(
      taskList
        .filter((taskItem) => normalizeString(taskItem?.attachmentId))
        .map((taskItem) => normalizeString(taskItem?.sessionId))
        .filter(Boolean),
    );
    const pendingItems = (Array.isArray(taskResults) ? taskResults : []).filter(
      (item = {}) => {
        const status = normalizeString(item?.status);
        const sessionId = normalizeString(item?.request?.sessionId);
        if (!sessionId) return false;
        if (
          ![TASK_STATUS.COMPLETED, TASK_STATUS.FAILED, TASK_STATUS.STOPPED].includes(
            status,
          )
        ) {
          return false;
        }
        return !attachedSessionIdSet.has(sessionId);
      },
    );
    if (!pendingItems.length) return emptyPersistOutput;

    const generatedAttachments = pendingItems.map((item = {}, index) => {
      const status = String(item?.status || "").trim() || TASK_STATUS.RUNNING;
      const taskName = normalizeString(item?.request?.taskName);
      const sessionId = normalizeString(item?.request?.sessionId);
      const fileLabel =
        toSafeArtifactName(taskName) || toSafeArtifactName(sessionId) || `task_${index + 1}`;
      const markdownText = toFinalResultMarkdownText({ taskResultItem: item, tAgentCollab, runtime });
      return {
        __sessionId: sessionId,
        name: `subtask-${fileLabel}-${status}.md`,
        mimeType: MIME_TYPE.TEXT_MARKDOWN,
        contentBase64: Buffer.from(markdownText || tAgentCollab(runtime, "noResult"), "utf8").toString("base64"),
      };
    });

    let persisted = null;
    let attachmentMetas = [];
    try {
      persisted = await persistTransferArtifacts({
        runtime,
        attachmentService,
        userId,
        sessionId: attachmentSessionId,
        attachmentSource: "subtask",
        generationSource: "async_subtask_result",
        fallbackMimeType: MIME_TYPE.TEXT_MARKDOWN,
        source: "agent",
        reason: "async_subtask_result",
        artifacts: generatedAttachments,
      });
      attachmentMetas = Array.isArray(persisted?.attachmentMetas) ? persisted.attachmentMetas : [];
    } catch (error) {
      logError("[agent-collab-tool] persistCompletedTaskResultsAsAttachments failed", {
        containerId: String(container?.id || ""),
        error: error?.message || String(error),
      });
      return emptyPersistOutput;
    }

    for (let index = 0; index < attachmentMetas.length; index += 1) {
      const meta = attachmentMetas[index] || {};
      const artifact = generatedAttachments[index] || {};
      const sessionId = String(artifact?.__sessionId || "").trim();
      if (!sessionId) continue;
      patchAsyncResultTask({
        containerId: String(container?.id || "").trim(),
        sessionId,
        patch: {
          attachmentId: String(meta?.attachmentId || "").trim(),
          attachmentName: String(meta?.name || artifact?.name || "").trim(),
        },
      });
    }
    const transferEnvelope =
      persisted?.envelope && typeof persisted.envelope === "object" && !Array.isArray(persisted.envelope)
        ? persisted.envelope
        : persisted?.result?.envelope && typeof persisted.result.envelope === "object" && !Array.isArray(persisted.result.envelope)
          ? persisted.result.envelope
          : null;
    const transferResult =
      persisted?.result && typeof persisted.result === "object" && !Array.isArray(persisted.result)
        ? persisted.result
        : null;
    return {
      attachmentMetas,
      transferResult,
      transferEnvelope,
      transferEnvelopes: transferEnvelope ? [transferEnvelope] : [],
    };
  };
}
