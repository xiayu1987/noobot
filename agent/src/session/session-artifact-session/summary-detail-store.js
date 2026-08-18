/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { filePath as path } from "@noobot/path-resolver";
import { createHash } from "node:crypto";
import { countCanonicalThinkingDetailEvents } from "@noobot/event-protocol/tool-timeline";
import { mkdir, readdir, rm } from "node:fs/promises";
import { SESSION_ARTIFACT_FILE_NAMES } from "../session-artifact-files.js";
import { readJsonWithStorage, writeJsonWithStorage } from "./artifact-json-io.js";

function resolveSummaryDetailPath(sessionDir = "", file = "") {
  const reference = String(file || "").replaceAll("\\", "/");
  const normalized = path.normalize(reference);
  const root = path.resolve(sessionDir, SESSION_ARTIFACT_FILE_NAMES.sessionSummaryDetailsDir);
  const resolved = path.resolve(sessionDir, normalized);
  if (
    !reference ||
    path.isAbsolute(reference) ||
    reference.includes("\0") ||
    normalized === "." ||
    normalized.startsWith(`..${path.sep}`) ||
    (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) ||
    path.extname(resolved) !== ".json"
  ) {
    const error = new Error(`invalid session summary detail reference: ${reference}`);
    error.code = "SESSION_SUMMARY_DETAIL_PATH_INVALID";
    throw error;
  }
  return resolved;
}

function summaryDetailHash(payload) {
  return `sha256:${createHash("sha256").update(JSON.stringify(payload)).digest("hex")}`;
}

export async function writeSessionSummaryDetails({
  storageService,
  sessionDir,
  summaryPayload,
}) {
  const detailsDir = path.join(sessionDir, SESSION_ARTIFACT_FILE_NAMES.sessionSummaryDetailsDir);
  await mkdir(detailsDir, { recursive: true });
  const referenced = new Set();
  const messages = [];
  for (const message of Array.isArray(summaryPayload?.messages) ? summaryPayload.messages : []) {
    const toolTimeline = Array.isArray(message?.toolTimeline) ? message.toolTimeline : [];
    const activityTimeline = Array.isArray(message?.activityTimeline)
      ? message.activityTimeline
      : [];
    if (!toolTimeline.length && !activityTimeline.length) {
      messages.push(message);
      continue;
    }
    const presentationMessageId = String(
      message?.presentationMessageId || message?.messageId || message?.id || "",
    ).trim();
    if (!presentationMessageId)
      throw new TypeError("summary detail requires presentation message identity");
    const detail = { schemaVersion: 1, presentationMessageId, toolTimeline, activityTimeline };
    const filename = `${encodeURIComponent(presentationMessageId)}.json`;
    const relative = `${SESSION_ARTIFACT_FILE_NAMES.sessionSummaryDetailsDir}/${filename}`;
    referenced.add(relative);
    await writeJsonWithStorage({
      storageService,
      artifactPath: resolveSummaryDetailPath(sessionDir, relative),
      payload: detail,
      atomic: true,
    });
    const { toolTimeline: _tool, activityTimeline: _activity, ...light } = message;
    const thinkingDetailCount = countCanonicalThinkingDetailEvents({
      toolTimeline,
      activityTimeline,
    });
    messages.push({
      ...light,
      hasThinkingDetails: true,
      thinkingDetailCount,
      thinkingDetailRef: { file: relative, contentHash: summaryDetailHash(detail) },
    });
  }
  summaryPayload.messages = messages;
  for (const entry of await readdir(detailsDir, { withFileTypes: true })) {
    if (entry.isFile() && entry.name.endsWith(".json")) {
      const relative = `${SESSION_ARTIFACT_FILE_NAMES.sessionSummaryDetailsDir}/${entry.name}`;
      if (!referenced.has(relative)) await rm(path.join(detailsDir, entry.name), { force: true });
    }
  }
  return summaryPayload;
}

export async function hydrateSessionSummaryDetails({ storageService, sessionDir, payload }) {
  const messages = (Array.isArray(payload?.messages) ? payload.messages : []).map(
    async (message) => {
      const ref = message?.thinkingDetailRef;
      if (!ref || typeof ref !== "object") return message;
      const detail = await readJsonWithStorage({
        storageService,
        artifactPath: resolveSummaryDetailPath(sessionDir, ref.file),
        fallback: null,
      });
      if (
        !detail ||
        detail.presentationMessageId !==
          String(message?.presentationMessageId || message?.messageId || message?.id || "") ||
        summaryDetailHash(detail) !== ref.contentHash
      ) {
        const error = new Error(`session summary detail does not match its reference: ${ref.file}`);
        error.code = "SESSION_SUMMARY_DETAIL_REFERENCE_MISMATCH";
        throw error;
      }
      return {
        ...message,
        toolTimeline: detail.toolTimeline,
        activityTimeline: detail.activityTimeline,
      };
    },
  );
  return { ...payload, messages: await Promise.all(messages) };
}
