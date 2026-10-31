/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { CONNECTOR_FAILURE_CODE } from "@noobot/connector-protocol";

export function connectorFailure(code, error, output) {
  return Object.freeze({ ok: false, code, error, ...(output === undefined ? {} : { output }) });
}

export function commandOutput(output) {
  return Object.freeze({ ok: true, output });
}

export function errorMessage(error) {
  if (!(error instanceof Error)) throw error;
  return error.message;
}

export async function loadDriverModule(moduleName) {
  try {
    const mod = await import(moduleName);
    return { ok: true, driver: mod.default ?? mod };
  } catch (error) {
    if (error?.code !== "ERR_MODULE_NOT_FOUND") throw error;
    return {
      ok: false,
      failure: connectorFailure(
        CONNECTOR_FAILURE_CODE.DEPENDENCY_MISSING,
        `${moduleName} is not installed`,
      ),
    };
  }
}
