/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { SESSION_DELETED_REASON, isSessionDeletedError } from "@noobot/session-protocol";

export async function resolveDeletedSessionAs(mutation, deletedResult) {
  try {
    return await mutation;
  } catch (error) {
    if (isSessionDeletedError(error)) return { ...deletedResult, reason: SESSION_DELETED_REASON };
    throw error;
  }
}
