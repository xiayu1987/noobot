/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { translateStoredLocaleMessageKey } from "../shared/i18n/messageCatalog.js";
import { requireFunctionDependencies } from "@noobot/shared/value";

function describeError(error) {
  return error instanceof Error ? error.message : String(error);
}

export function installGlobalErrorBoundary(app, { target, notifyError }) {
  requireFunctionDependencies("installGlobalErrorBoundary", {
    addEventListener: target.addEventListener,
    notifyError,
  });
  function reportUnexpectedError(error) {
    console.error("[noobot] unexpected error", error);
    notifyError(
      translateStoredLocaleMessageKey("infra.unexpectedError", { message: describeError(error) }),
    );
  }
  app.config.errorHandler = reportUnexpectedError;
  target.addEventListener("unhandledrejection", (event) => {
    event.preventDefault();
    reportUnexpectedError(event.reason);
  });
}
