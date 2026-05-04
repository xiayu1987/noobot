/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import express from "express";

export function registerGlobalMiddlewares(
  app,
  {
    resolveRequestLocale,
    defaultLocale,
  } = {},
) {
  app.use(express.json({ limit: "20mb" }));
  app.use((req, _res, next) => {
    req.locale = resolveRequestLocale(req, defaultLocale);
    next();
  });
}
