/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { sessionMutationCoordinator } from "../session-mutation-coordinator.js";
import { sessionAccessMethods } from "./file-system-session-repository/access-methods.js";
import { sessionArtifactMethods } from "./file-system-session-repository/artifact-methods.js";
import { sessionCrudMethods } from "./file-system-session-repository/crud-methods.js";
import { installRepositoryMethods } from "./file-system-session-repository/install-methods.js";
import { sessionLifecycleMethods } from "./file-system-session-repository/lifecycle-methods.js";
import { sessionSummaryMethods } from "./file-system-session-repository/summary-methods.js";
import { normalizeSelectedConnectorIds } from "@noobot/connector-protocol";

export class FileSystemSessionRepository {
  constructor({
    pathResolver,
    sessionPathResolver,
    storageService,
    normalizeMessages,
    now = () => new Date().toISOString(),
    mutationLockTimeoutMs = 30000,
    mutationLockStaleMs = 60000,
    mutationLockPollMs = 10,
  } = {}) {
    this.pathResolver = pathResolver;
    this.sessionPathResolver = sessionPathResolver;
    this.storageService = storageService;
    this.normalizeMessages = normalizeMessages;
    this.normalizeSelectedConnectorIds = normalizeSelectedConnectorIds;
    this.now = now;
    this.mutationLockTimeoutMs = Math.max(1, Number(mutationLockTimeoutMs) || 30000);
    this.mutationLockStaleMs = Math.max(1, Number(mutationLockStaleMs) || 60000);
    this.mutationLockPollMs = Math.max(1, Number(mutationLockPollMs) || 10);
    this.mutationCoordinator = sessionMutationCoordinator;
    this._deletedSessionCache = new Map();
    this._heldMutationLocks = new Map();
  }
}

installRepositoryMethods(
  FileSystemSessionRepository,
  sessionLifecycleMethods,
  sessionSummaryMethods,
  sessionAccessMethods,
  sessionArtifactMethods,
  sessionCrudMethods,
);
