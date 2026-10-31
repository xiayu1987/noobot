/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  downloadWorkspaceFileMutationApi,
  getWorkspaceFileMutationDiffApi,
  getWorkspaceFileMutationFileApi,
} from "../chat/chatApi.js";
import { requireAuthenticatedFetcher } from "../../http/authenticatedHttpService.js";
import { saveFileBlob } from "../../downloads/fileDownloadService.js";

async function getMutationFile({
  userId = "",
  sessionId = "",
  sessionScope = null,
  mutationId = "",
} = {}) {
  const response = await getWorkspaceFileMutationFileApi(
    { userId, sessionId, sessionScope, mutationId },
    { fetcher: requireAuthenticatedFetcher() },
  );
  if (!response?.ok) throw new Error(`failed to load file: ${response?.status || 500}`);
  const data = await response.json();
  if (!data?.ok) throw new Error(data?.error || "file not found");
  return data;
}
export const fileMutationPreviewService = Object.freeze({
  async getFile({ userId = "", sessionId = "", sessionScope = null, mutationId = "" } = {}) {
    return getMutationFile({ userId, sessionId, sessionScope, mutationId });
  },
  async getDiff({ userId = "", sessionId = "", sessionScope = null, mutationId = "" } = {}) {
    const response = await getWorkspaceFileMutationDiffApi(
      { userId, sessionId, sessionScope, mutationId },
      { fetcher: requireAuthenticatedFetcher() },
    );
    if (!response?.ok) throw new Error(`failed to load file diff: ${response?.status || 500}`);
    const data = await response.json();
    if (!data?.ok) throw new Error(data?.error || "file diff not found");
    return data;
  },

  async downloadFile({ userId = "", sessionId = "", mutationRef } = {}) {
    const response = await downloadWorkspaceFileMutationApi(
      {
        userId,
        sessionId,
        sessionScope: mutationRef.sessionScope,
        mutationId: mutationRef.mutationId,
        version: { revision: mutationRef.revision, afterSha256: mutationRef.afterSha256 },
      },
      { fetcher: requireAuthenticatedFetcher() },
    );
    if (!response.ok) {
      const data = await response.json();
      const error = new Error(data.error);
      error.code = data.errorCode;
      error.statusCode = response.status;
      throw error;
    }
    await saveFileBlob(await response.blob(), mutationRef.fileName);
  },
});
