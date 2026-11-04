/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { isCanonicalText, isFunction, isPlainObject } from "@noobot/shared/value";

function assertFinalizationPort(name, port, methods) {
  for (const method of methods) {
    if (isFunction(port?.[method])) continue;
    const error = new TypeError(`session finalization requires ${name}.${method}`);
    error.code = "SESSION_FINALIZATION_PORT_INVALID";
    throw error;
  }
}

export function assertSessionFinalizationContext({
  lifecycle,
  runtimeEventListener,
  parentDialogProcessId,
  userConfig,
}) {
  for (const [name, port, methods] of [
    ["lifecycle", lifecycle, ["enterPersisting", "enterMemory"]],
    ["runtimeEventListener", runtimeEventListener, ["onEvent", "flush"]],
  ]) {
    assertFinalizationPort(name, port, methods);
  }
  if (parentDialogProcessId !== "" && !isCanonicalText(parentDialogProcessId)) {
    throw new TypeError(
      "session finalization parentDialogProcessId must be empty or canonical text",
    );
  }
  if (!isPlainObject(userConfig)) {
    throw new TypeError("session finalization userConfig must be a plain object");
  }
}
