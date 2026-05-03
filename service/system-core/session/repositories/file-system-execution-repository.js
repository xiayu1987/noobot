/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { normalizeExecutionLogEntity } from "../entities.js";
import { fatalSystemError } from "../../error/index.js";
import { tSystem } from "../../i18n/system-text.js";

export class FileSystemExecutionRepository {
  constructor({
    sessionRepository,
    now = () => new Date().toISOString(),
  } = {}) {
    this.sessionRepository = sessionRepository;
    this.now = now;
  }

  async getBundle(userId, sessionId, parentSessionId = "") {
    const normalizedSessionId = String(sessionId || "").trim();
    if (!normalizedSessionId) {
      throw fatalSystemError(tSystem("common.sessionIdRequired"), {
        code: "FATAL_SESSION_ID_REQUIRED",
      });
    }
    return this.sessionRepository.getExecutionBundle(
      userId,
      normalizedSessionId,
      parentSessionId,
    );
  }

  async appendLog(userId, sessionId, executionLog = {}, parentSessionId = "") {
    const normalizedSessionId = String(sessionId || "").trim();
    if (!normalizedSessionId) {
      throw fatalSystemError(tSystem("common.sessionIdRequired"), {
        code: "FATAL_SESSION_ID_REQUIRED",
      });
    }
    const bundle = await this.getBundle(
      userId,
      normalizedSessionId,
      parentSessionId,
    );
    bundle.logs = Array.isArray(bundle.logs) ? bundle.logs : [];
    bundle.logs.push(normalizeExecutionLogEntity(executionLog, this.now));
    bundle.updatedAt = this.now();
    await this.sessionRepository.saveExecutionBundle(
      userId,
      normalizedSessionId,
      bundle,
      parentSessionId,
    );
  }
}
