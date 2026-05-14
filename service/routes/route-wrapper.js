/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

export function withJsonError(
  handler,
  {
    statusCode = 400,
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
