/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { Buffer } from "node:buffer";
import {
  RUNTIME_EVENT_CATEGORIES,
  RUNTIME_EVENT_CHANNELS,
  writeRoutedRuntimeEvent,
} from "@noobot/runtime-events";
import { mapAttachmentRecordsToMetas } from "../../../attach/meta-ops.js";
import { TASK_STATUS } from "../../../bot-manage/async/constants.js";
import { MIME_TYPE } from "../../../constants/index.js";
import { normalizeString } from "./collab-task-utils.js";
import { normalizeParentSessionId } from "../../../context/parent-session-id-resolver.js";

const ASYNC_SUBTASK_RESULT_GENERATION_SOURCE = "async_subtask_result";

async function recordCollabArtifactPersistFailure({
  runtime,
  userId,
  sessionId,
  parentSessionId,
  containerId,
  error,
} = {}) {
  await writeRoutedRuntimeEvent({
      source: "agent",
      channel: RUNTIME_EVENT_CHANNELS.DIRECT,
      category: RUNTIME_EVENT_CATEGORIES.SYSTEM,
      event: "agent.collab.persistCompletedTaskResultsAsAttachments.failed",
      userId,
      sessionId,
      parentSessionId,
      data: {
        containerId: String(containerId || ""),
        error: error?.message || String(error || ""),
      },
    }, {
    workspaceRoot: runtime?.globalConfig?.workspaceRoot || "",
  }).catch(() => {});
}

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
      void writeRoutedRuntimeEvent({
        source: "agent",
        channel: RUNTIME_EVENT_CHANNELS.DIRECT,
        category: RUNTIME_EVENT_CATEGORIES.SYSTEM,
        level: "warn",
        event: "agent.collab.taskResult.stringify.failed",
        data: { hasRawResult: true },
        error,
      }, { workspaceRoot: runtime?.globalConfig?.workspaceRoot || "" });
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
    attachments: [],
    transferEnvelopes: [],
  };
  return async function persistCompletedTaskResultsAsAttachments({
    container = {},
    taskResults = [],
  } = {}) {
    if (!attachmentService || !userId) return emptyPersistOutput;
    const parentSessionId = normalizeParentSessionId(container?.parentSessionId);
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
          ![TASK_STATUS.COMPLETED, TASK_STATUS.FAILED, TASK_STATUS.USER_STOPPED].includes(
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

    let attachments = [];
    try {
      const records = await attachmentService.ingestGeneratedArtifacts({
        userId,
        sessionId: attachmentSessionId,
        attachmentSource: "subtask",
        generationSource: ASYNC_SUBTASK_RESULT_GENERATION_SOURCE,
        artifacts: generatedAttachments,
      });
      attachments = mapAttachmentRecordsToMetas(records, {
        fallbackMimeType: MIME_TYPE.TEXT_MARKDOWN,
        fallbackGenerationSource: ASYNC_SUBTASK_RESULT_GENERATION_SOURCE,
      });
    } catch (error) {
      await recordCollabArtifactPersistFailure({
        runtime,
        userId,
        sessionId: attachmentSessionId,
        parentSessionId,
        containerId: container?.id,
        error,
      });
      return emptyPersistOutput;
    }

    for (let index = 0; index < attachments.length; index += 1) {
      const meta = attachments[index] || {};
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
    return {
      attachments,
      transferEnvelopes: [],
    };
  };
}
