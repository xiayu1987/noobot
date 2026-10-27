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
import { getSessionThinkingDetailApi } from "../chat/chatApi.js";
import { requireAuthenticatedFetcher } from "../../http/authenticatedHttpService.js";

export const thinkingDetailService = Object.freeze({
  async getDetail({ userId, sessionId, dialogProcessId, turnScopeId }) {
    const response = await getSessionThinkingDetailApi(
      { userId, sessionId, dialogProcessId, turnScopeId },
      { fetcher: requireAuthenticatedFetcher() },
    );
    const payload = await readApiResponseEnvelope(response);
    if (payload.exists !== true) {
      throw new ApiRequestError("thinking detail not found", {
        code: API_REQUEST_ERROR_CODE.NOT_FOUND,
        status: response.status,
      });
    }
    return payload;
  },
});
