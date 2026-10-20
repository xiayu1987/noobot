/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { HTTP_STATUS } from "#agent/constants";
import { text } from "@noobot/shared/value";

export function createBadRequestError(message, { code = "" } = {}) {
  const error = new Error(message);
  error.statusCode = HTTP_STATUS.BAD_REQUEST;
  if (code) error.code = code;
  return error;
}

export function decodeRequestInput(decode) {
  try {
    return decode();
  } catch (error) {
    if (error instanceof Error && !Number.isInteger(Number(error.statusCode))) {
      error.statusCode = HTTP_STATUS.BAD_REQUEST;
    }
    throw error;
  }
}

export function classifyRequestedPathError(error) {
  if ((error?.code === "ENOENT" || error?.code === "ENOTDIR") && error.statusCode === undefined) {
    error.statusCode = HTTP_STATUS.BAD_REQUEST;
  }
  return error;
}

export function withJsonError(
  handler,
  {
    statusCode = HTTP_STATUS.INTERNAL_SERVER_ERROR,
    fallbackErrorKey = "",
    translateText = () => "",
  } = {},
) {
  return async (req, res) => {
    try {
      return await handler(req, res);
    } catch (error) {
      const fallbackMessage = fallbackErrorKey ? translateText(fallbackErrorKey, req?.locale) : "";
      const errorStatusCode = Number(error?.statusCode);
      const responseStatusCode =
        Number.isInteger(errorStatusCode) && errorStatusCode >= 400 && errorStatusCode < 600
          ? errorStatusCode
          : statusCode;
      const errorCode = text(error?.code);
      const hasCurrentVersion =
        error?.currentVersion !== undefined &&
        error?.currentVersion !== null &&
        String(error.currentVersion).trim() !== "";
      const currentVersion = Number(error?.currentVersion);
      res.status(responseStatusCode).json({
        ok: false,
        error: error?.message || fallbackMessage || String(error || "request failed"),
        ...(errorCode ? { errorCode } : {}),
        ...(hasCurrentVersion && Number.isFinite(currentVersion) ? { currentVersion } : {}),
      });
    }
    return undefined;
  };
}

export function createJsonRouteWrapper({
  statusCode = HTTP_STATUS.INTERNAL_SERVER_ERROR,
  fallbackErrorKey = "",
  translateText = () => "",
} = {}) {
  return (handler, overrideOptions = {}) =>
    withJsonError(handler, {
      statusCode,
      fallbackErrorKey,
      translateText,
      ...(overrideOptions && typeof overrideOptions === "object" ? overrideOptions : {}),
    });
}
