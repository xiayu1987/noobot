/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { RoleEnum } from "../../model/chatConstants.js";
import { getMessageDialogProcessId, getMessageRole } from "../../model/messageIdentity.js";
import { text } from "@noobot/shared/value";

export function _trimStr(x) {
  return text(x);
}

export function _isAssistantRole(msg) {
  return getMessageRole(msg) === RoleEnum.ASSISTANT;
}

export function _matchesDialogProcessId(msg, dpId) {
  return getMessageDialogProcessId(msg) === _trimStr(dpId);
}
