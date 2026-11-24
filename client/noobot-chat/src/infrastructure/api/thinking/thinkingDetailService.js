/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  API_REQUEST_ERROR_CODE,
  ApiRequestError,
  readApiResponseEnvelope,
} from "@noobot/shared/request-error";
import { getSessionThinkingDetailApi, releaseSessionThinkingDetailApi } from "../chat/chatApi.js";
import { requireAuthenticatedFetcher } from "../../http/authenticatedHttpService.js";
import { QUANTITY_THRESHOLDS } from "@noobot/shared/quantity-thresholds";
import { buildThinkingDetailPagePayload } from "@noobot/event-protocol/thinking-detail-projection";
import {
  prepareThinkingDetailPageTransition,
  requireThinkingDetailReleaseSelection,
  requireSessionPageReleaseResult,
} from "@noobot/session-protocol/message-read-budget";
import { readRetainedSessionPage } from "@noobot/session-protocol/retained-session-page";

async function releaseThinkingDetail(
  { userId, sessionId, dialogProcessId, turnScopeId, cursor },
  fetcher,
) {
  const selection = requireThinkingDetailReleaseSelection({
    sessionId,
    dialogProcessId,
    turnScopeId,
    cursor,
  });
  const response = await releaseSessionThinkingDetailApi({ userId, ...selection }, { fetcher });
  return requireSessionPageReleaseResult(await readApiResponseEnvelope(response));
}

export const thinkingDetailService = Object.freeze({
  async release(selection) {
    return releaseThinkingDetail(selection, requireAuthenticatedFetcher());
  },
  async getPage({
    userId,
    sessionId,
    dialogProcessId,
    turnScopeId,
    cursor = null,
    snapshot = null,
  }) {
    const limit = QUANTITY_THRESHOLDS.sessionStorage.messageReadPageSize;
    const selection = { sessionId, dialogProcessId, turnScopeId, cursor, limit };
    const validate = prepareThinkingDetailPageTransition(selection, snapshot);
    const fetcher = requireAuthenticatedFetcher();
    const scope = { userId, sessionId, dialogProcessId, turnScopeId };
    return readRetainedSessionPage({
      cursor,
      async receive() {
        const response = await getSessionThinkingDetailApi(
          { ...scope, cursor, limit },
          { fetcher },
        );
        return { page: await readApiResponseEnvelope(response), status: response.status };
      },
      accept(page, { status }) {
        const detail = buildThinkingDetailPagePayload(validate(page), selection);
        if (detail.exists === false)
          throw new ApiRequestError("thinking detail not found", {
            code: API_REQUEST_ERROR_CODE.NOT_FOUND,
            status,
          });
        return detail;
      },
      release: (releaseCursor) =>
        releaseThinkingDetail({ ...scope, cursor: releaseCursor }, fetcher),
    });
  },
});
