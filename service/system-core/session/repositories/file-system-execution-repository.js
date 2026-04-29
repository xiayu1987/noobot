/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { normalizeExecutionLogEntity } from "../entities.js";

export class FileSystemExecutionRepository {
  constructor({
    sessionRepository,
    now = () => new Date().toISOString(),
  } = {}) {
    this.sessionRepository = sessionRepository;
    this.now = now;
  }

  async getBundle(userId, sessionId, parentSessionId = "") {
    return this.sessionRepository.getExecutionBundle(
      userId,
      sessionId,
      parentSessionId,
    );
  }

  async appendLog(userId, sessionId, executionLog = {}, parentSessionId = "") {
    const bundle = await this.getBundle(userId, sessionId, parentSessionId);
    bundle.logs = Array.isArray(bundle.logs) ? bundle.logs : [];
    bundle.logs.push(normalizeExecutionLogEntity(executionLog, this.now));
    bundle.updatedAt = this.now();
    await this.sessionRepository.saveExecutionBundle(
      userId,
      sessionId,
      bundle,
      parentSessionId,
    );
  }
}
