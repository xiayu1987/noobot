/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { FileMutationCoordinator } from "../shared/storage/file-mutation-coordinator.js";

export class SessionMutationCoordinator extends FileMutationCoordinator {
  constructor(options = {}) {
    super({
      timeoutMessage: "session mutation lock timeout",
      timeoutErrorCode: "SESSION_MUTATION_BUSY",
      operationName: "sessionMutation.refreshLock",
      ...options,
    });
  }
}

export const sessionMutationCoordinator = new SessionMutationCoordinator();
