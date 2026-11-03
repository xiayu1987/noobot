/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { SessionMutationCoordinator } from "../session-mutation-coordinator.js";
import { sessionAccessMethods } from "./file-system-session-repository/access-methods.js";
import { agentSessionMethods } from "./file-system-session-repository/agent-session-methods.js";
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
    sessionTreeRepository,
    storageService,
    now = () => new Date().toISOString(),
  } = {}) {
    if (!sessionTreeRepository) {
      throw new TypeError("FileSystemSessionRepository requires sessionTreeRepository");
    }
    this.pathResolver = pathResolver;
    this.sessionPathResolver = sessionPathResolver;
    this.sessionTreeRepository = sessionTreeRepository;
    this.storageService = storageService;
    this.normalizeSelectedConnectorIds = normalizeSelectedConnectorIds;
    this.now = now;
    this.mutationCoordinator = new SessionMutationCoordinator();
  }
}

installRepositoryMethods(
  FileSystemSessionRepository,
  sessionLifecycleMethods,
  agentSessionMethods,
  sessionSummaryMethods,
  sessionAccessMethods,
  sessionArtifactMethods,
  sessionCrudMethods,
);
