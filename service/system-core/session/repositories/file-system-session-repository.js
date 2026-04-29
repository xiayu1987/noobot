/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { mkdir, readdir, rm } from "node:fs/promises";
import path from "node:path";
import { fatalSystemError } from "../../error/index.js";

export class FileSystemSessionRepository {
  constructor({
    pathResolver,
    storageService,
    treeRepository,
    normalizeMessages,
    normalizeSelectedConnectors,
    now = () => new Date().toISOString(),
  } = {}) {
    this.pathResolver = pathResolver;
    this.storageService = storageService;
    this.treeRepository = treeRepository;
    this.normalizeMessages = normalizeMessages;
    this.normalizeSelectedConnectors = normalizeSelectedConnectors;
    this.now = now;
  }

  _basePath(userId = "") {
    return this.pathResolver.resolveBasePath(userId);
  }

  _sessionRoot(userId = "") {
    return this.pathResolver.sessionRoot(this._basePath(userId));
  }

  async resolveParentSessionId(userId, sessionId, parentSessionId = "") {
    const hintedParentSessionId = String(parentSessionId || "").trim();
    if (hintedParentSessionId) {
      const tree = await this.treeRepository.getTree(userId);
      if (!tree?.nodes?.[hintedParentSessionId]) {
        throw fatalSystemError(
          `parent session not found (possibly deleted): ${hintedParentSessionId}`,
          {
            code: "FATAL_PARENT_SESSION_MISSING",
            details: { hintedParentSessionId },
          },
        );
      }
      return hintedParentSessionId;
    }

    const normalizedSessionId = String(sessionId || "").trim();
    if (!normalizedSessionId) return "";

    const tree = await this.treeRepository.getTree(userId);
    return String(tree?.nodes?.[normalizedSessionId]?.parentSessionId || "").trim();
  }

  async resolveSessionDir(userId, sessionId, parentSessionId = "") {
    const normalizedSessionId = String(sessionId || "").trim();
    if (!normalizedSessionId) return this._sessionRoot(userId);

    const normalizedParentSessionId = String(parentSessionId || "").trim();
    if (
      normalizedParentSessionId &&
      normalizedParentSessionId !== normalizedSessionId
    ) {
      const parentDir = await this.resolveSessionDir(
        userId,
        normalizedParentSessionId,
      );
      return path.join(parentDir, normalizedSessionId);
    }

    const tree = await this.treeRepository.getTree(userId);
    const chain = this.treeRepository.loopSession(normalizedSessionId, tree, []);
    return path.join(this._sessionRoot(userId), ...chain.reverse());
  }

  async resolveSessionScope(userId, sessionId, parentSessionId = "") {
    const resolvedParentSessionId = await this.resolveParentSessionId(
      userId,
      sessionId,
      parentSessionId,
    );
    const sessionDir = await this.resolveSessionDir(
      userId,
      sessionId,
      resolvedParentSessionId,
    );
    return {
      resolvedParentSessionId,
      sessionDir,
      sessionFile: path.join(sessionDir, "session.json"),
      taskFile: path.join(sessionDir, "task.json"),
      executionFile: path.join(sessionDir, "execution.json"),
    };
  }

  async listSessionIds(userId) {
    const basePath = this._basePath(userId);
    await this.storageService.ensureRuntimeDirsByBasePath(basePath);
    let entries = [];
    try {
      entries = await readdir(this._sessionRoot(userId), { withFileTypes: true });
    } catch {
      return [];
    }
    return entries
      .filter((dirEntry) => dirEntry.isDirectory())
      .map((dirEntry) => dirEntry.name);
  }

  async ensureSession({ userId, sessionId, parentSessionId = "", meta = {} }) {
    const basePath = this._basePath(userId);
    await this.storageService.ensureRuntimeDirsByBasePath(basePath);
    const { resolvedParentSessionId, sessionDir, sessionFile, taskFile, executionFile } =
      await this.resolveSessionScope(userId, sessionId, parentSessionId);

    await mkdir(sessionDir, { recursive: true });

    if (!(await this.storageService.exists(sessionFile))) {
      await this.storageService.writeJson(sessionFile, {
        sessionId,
        parentSessionId: resolvedParentSessionId || "",
        caller: meta?.caller || "user",
        modelAlias: meta?.modelAlias || "",
        currentTaskId: "",
        shortMemoryCheckpoint: 0,
        messages: [],
        selectedConnectors: {},
        createdAt: this.now(),
        updatedAt: this.now(),
      });
    }

    if (!(await this.storageService.exists(taskFile))) {
      await this.storageService.writeJson(taskFile, {
        sessionId,
        currentTaskId: "",
        tasks: [],
        updatedAt: this.now(),
      });
    }

    if (!(await this.storageService.exists(executionFile))) {
      await this.storageService.writeJson(executionFile, {
        sessionId,
        logs: [],
        updatedAt: this.now(),
      });
    }
  }

  async findById(userId, sessionId, parentSessionId = "") {
    const { resolvedParentSessionId, sessionFile } = await this.resolveSessionScope(
      userId,
      sessionId,
      parentSessionId,
    );
    if (!(await this.storageService.exists(sessionFile))) return null;

    const session = await this.storageService.readJson(sessionFile, {});
    session.sessionId = String(session.sessionId || sessionId || "").trim();
    session.parentSessionId = String(
      session.parentSessionId || resolvedParentSessionId || "",
    ).trim();
    session.caller = String(session.caller || "user").trim() || "user";
    session.modelAlias = String(session.modelAlias || "");
    session.messages = this.normalizeMessages(session.messages || []);
    session.selectedConnectors = this.normalizeSelectedConnectors(
      session.selectedConnectors || {},
    );
    return session;
  }

  async save(userId, session = {}, parentSessionId = "") {
    const sessionId = String(session?.sessionId || "").trim();
    if (!sessionId) {
      throw fatalSystemError("sessionId required", {
        code: "FATAL_SESSION_ID_REQUIRED",
      });
    }
    const { resolvedParentSessionId, sessionFile } = await this.resolveSessionScope(
      userId,
      sessionId,
      parentSessionId || session?.parentSessionId || "",
    );
    const payload = {
      ...session,
      sessionId,
      parentSessionId: String(
        session?.parentSessionId || resolvedParentSessionId || "",
      ).trim(),
      messages: this.normalizeMessages(session?.messages || []),
      selectedConnectors: this.normalizeSelectedConnectors(
        session?.selectedConnectors || {},
      ),
      updatedAt: this.now(),
    };
    await this.storageService.writeJson(sessionFile, payload);
  }

  async delete(userId, sessionId, parentSessionId = "") {
    const { sessionDir } = await this.resolveSessionScope(
      userId,
      sessionId,
      parentSessionId,
    );
    await rm(sessionDir, { recursive: true, force: true });
    return true;
  }

  async getTaskBundle(userId, sessionId, parentSessionId = "") {
    const { taskFile } = await this.resolveSessionScope(
      userId,
      sessionId,
      parentSessionId,
    );
    return this.storageService.readJson(taskFile, {
      sessionId,
      currentTaskId: "",
      tasks: [],
      updatedAt: this.now(),
    });
  }

  async saveTaskBundle(userId, sessionId, taskBundle = {}, parentSessionId = "") {
    const { taskFile } = await this.resolveSessionScope(
      userId,
      sessionId,
      parentSessionId,
    );
    await this.storageService.writeJson(taskFile, {
      sessionId,
      currentTaskId: String(taskBundle?.currentTaskId || "").trim(),
      tasks: Array.isArray(taskBundle?.tasks) ? taskBundle.tasks : [],
      updatedAt: this.now(),
    });
  }

  async getExecutionBundle(userId, sessionId, parentSessionId = "") {
    const { executionFile } = await this.resolveSessionScope(
      userId,
      sessionId,
      parentSessionId,
    );
    const bundle = await this.storageService.readJson(executionFile, {
      sessionId,
      logs: [],
      updatedAt: this.now(),
    });
    return {
      sessionId: String(bundle?.sessionId || sessionId || "").trim(),
      logs: Array.isArray(bundle?.logs) ? bundle.logs : [],
      updatedAt: bundle?.updatedAt || this.now(),
    };
  }

  async saveExecutionBundle(
    userId,
    sessionId,
    executionBundle = {},
    parentSessionId = "",
  ) {
    const { executionFile } = await this.resolveSessionScope(
      userId,
      sessionId,
      parentSessionId,
    );
    await this.storageService.writeJson(executionFile, {
      sessionId,
      logs: Array.isArray(executionBundle?.logs) ? executionBundle.logs : [],
      updatedAt: this.now(),
    });
  }
}
