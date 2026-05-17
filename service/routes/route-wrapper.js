/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { HTTP_STATUS } from "#agent/constants";

export function withJsonError(
  handler,
  {
    statusCode = HTTP_STATUS.BAD_REQUEST,
    fallbackErrorKey = "",
    translateText = () => "",
  } = {},
) {
  return async (req, res) => {
    try {
      return await handler(req, res);
    } catch (error) {
      const fallbackMessage = fallbackErrorKey
        ? translateText(fallbackErrorKey, req?.locale)
        : "";
      res.status(statusCode).json({
        ok: false,
        error: error?.message || fallbackMessage || String(error || "request failed"),
      });
    }
    return undefined;
  };
}

export function createJsonRouteWrapper(
  {
    statusCode = HTTP_STATUS.BAD_REQUEST,
    fallbackErrorKey = "",
    translateText = () => "",
  } = {},
) {
  return (handler, overrideOptions = {}) =>
    withJsonError(handler, {
      statusCode,
      fallbackErrorKey,
      translateText,
      ...(overrideOptions && typeof overrideOptions === "object"
        ? overrideOptions
        : {}),
    });
}
