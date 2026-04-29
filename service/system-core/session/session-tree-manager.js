/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { fatalSystemError } from "../error/index.js";

export class SessionTreeManager {
  constructor({ storageService, pathResolver, now = () => new Date().toISOString() } = {}) {
    this.storageService = storageService;
    this.pathResolver = pathResolver;
    this.now = now;
    this._locks = new Map();
  }

  loopSession(sessionId, tree, chain = []) {
    const normalizedSessionId = String(sessionId || "").trim();
    if (!normalizedSessionId) return chain;
    const parentSessionId = String(
      tree?.nodes?.[normalizedSessionId]?.parentSessionId || "",
    ).trim();
    const nextChain = chain.concat(normalizedSessionId);
    if (!parentSessionId) {
      return nextChain;
    }
    return this.loopSession(parentSessionId, tree, nextChain);
  }

  resolveRootSessionIdFromTree(sessionId = "", tree = {}) {
    const normalizedSessionId = String(sessionId || "").trim();
    if (!normalizedSessionId) return "";
    const nodes =
      tree?.nodes && typeof tree.nodes === "object" ? tree.nodes : {};
    if (!nodes?.[normalizedSessionId]) return normalizedSessionId;
    const chain = this.loopSession(normalizedSessionId, tree, []);
    return String(chain?.[chain.length - 1] || normalizedSessionId).trim();
  }

  normalizeSessionTreeShape(tree = {}) {
    const nodes =
      tree?.nodes && typeof tree.nodes === "object" ? { ...tree.nodes } : {};
    for (const [nodeId, node] of Object.entries(nodes)) {
      const normalizedNodeId = String(nodeId || "").trim();
      if (!normalizedNodeId) {
        delete nodes[nodeId];
        continue;
      }
      const normalizedChildren = Array.isArray(node?.children)
        ? Array.from(
            new Set(
              node.children
                .map((childId) => String(childId || "").trim())
                .filter(Boolean),
            ),
          )
        : [];
      nodes[normalizedNodeId] = {
        ...node,
        sessionId: normalizedNodeId,
        parentSessionId: String(node?.parentSessionId || "").trim(),
        children: normalizedChildren,
      };
      if (normalizedNodeId !== nodeId) delete nodes[nodeId];
    }

    const roots = Object.values(nodes)
      .filter((node) => !String(node?.parentSessionId || "").trim())
      .map((node) => String(node?.sessionId || "").trim())
      .filter(Boolean);

    return {
      roots: Array.from(new Set(roots)),
      nodes,
      updatedAt: tree?.updatedAt || this.now(),
    };
  }

  async withSessionTreeLock(basePath, run) {
    const lockKey = String(basePath || "");
    const previousLock = this._locks.get(lockKey) || Promise.resolve();
    let releaseCurrentLock = () => {};
    const currentLock = new Promise((resolve) => {
      releaseCurrentLock = resolve;
    });
    const lockMarker = previousLock.then(() => currentLock);
    this._locks.set(lockKey, lockMarker);

    await previousLock;
    try {
      return await run();
    } finally {
      releaseCurrentLock();
      if (this._locks.get(lockKey) === lockMarker) {
        this._locks.delete(lockKey);
      }
    }
  }

  async readSessionTree(basePath) {
    const ensured = await this.storageService.ensureRuntimeDirsByBasePath(basePath);
    if (!ensured) {
      return { roots: [], nodes: {}, updatedAt: this.now() };
    }
    const sessionTreeFile = this.pathResolver.sessionTreeFile(basePath);
    const sessionTreeData = await this.storageService.readJson(sessionTreeFile, {
      roots: [],
      nodes: {},
      updatedAt: this.now(),
    });
    return {
      roots: Array.isArray(sessionTreeData?.roots) ? sessionTreeData.roots : [],
      nodes:
        sessionTreeData?.nodes && typeof sessionTreeData.nodes === "object"
          ? sessionTreeData.nodes
          : {},
      updatedAt: sessionTreeData?.updatedAt || this.now(),
    };
  }

  async writeSessionTree(basePath, tree) {
    const ensured = await this.storageService.ensureRuntimeDirsByBasePath(basePath);
    if (!ensured) {
      throw fatalSystemError(`workspace not initialized: ${basePath}`, {
        code: "FATAL_WORKSPACE_NOT_INITIALIZED",
        details: { basePath },
      });
    }
    const payload = {
      roots: Array.isArray(tree?.roots) ? tree.roots : [],
      nodes: tree?.nodes && typeof tree.nodes === "object" ? tree.nodes : {},
      updatedAt: this.now(),
    };
    const treeFile = this.pathResolver.sessionTreeFile(basePath);
    await this.storageService.writeJsonAtomic(treeFile, payload);
  }

  async upsertSessionTree({ basePath, sessionId, parentSessionId = "" }) {
    if (!sessionId) return;
    await this.withSessionTreeLock(basePath, async () => {
      const sessionTree = this.normalizeSessionTreeShape(
        await this.readSessionTree(basePath),
      );
      const now = this.now();
      const normalizedSessionId = String(sessionId || "").trim();
      const normalizedParentSessionId = String(parentSessionId || "").trim();

      if (!sessionTree.nodes[normalizedSessionId]) {
        sessionTree.nodes[normalizedSessionId] = {
          sessionId: normalizedSessionId,
          parentSessionId: normalizedParentSessionId,
          children: [],
          createdAt: now,
          updatedAt: now,
        };
      } else {
        sessionTree.nodes[normalizedSessionId].parentSessionId =
          normalizedParentSessionId;
        sessionTree.nodes[normalizedSessionId].updatedAt = now;
        if (!Array.isArray(sessionTree.nodes[normalizedSessionId].children)) {
          sessionTree.nodes[normalizedSessionId].children = [];
        }
      }

      for (const [nodeId, node] of Object.entries(sessionTree.nodes || {})) {
        if (nodeId === normalizedParentSessionId) continue;
        const children = Array.isArray(node?.children) ? node.children : [];
        sessionTree.nodes[nodeId].children = children.filter(
          (childId) => String(childId || "").trim() !== normalizedSessionId,
        );
      }

      if (normalizedParentSessionId) {
        if (!sessionTree.nodes[normalizedParentSessionId]) {
          throw fatalSystemError(
            `parent session not found (possibly deleted): ${normalizedParentSessionId}`,
            {
              code: "FATAL_PARENT_SESSION_MISSING",
              details: { normalizedParentSessionId },
            },
          );
        }
        const parentChildren = Array.isArray(
          sessionTree.nodes[normalizedParentSessionId].children,
        )
          ? sessionTree.nodes[normalizedParentSessionId].children
          : [];
        if (!parentChildren.includes(normalizedSessionId)) {
          parentChildren.push(normalizedSessionId);
        }
        sessionTree.nodes[normalizedParentSessionId].children = parentChildren;
        sessionTree.nodes[normalizedParentSessionId].updatedAt = now;
        sessionTree.roots = sessionTree.roots.filter(
          (rootSessionId) => rootSessionId !== normalizedSessionId,
        );
        if (
          !sessionTree.roots.includes(normalizedParentSessionId) &&
          !String(
            sessionTree.nodes[normalizedParentSessionId].parentSessionId || "",
          )
        ) {
          sessionTree.roots.push(normalizedParentSessionId);
        }
      }

      await this.writeSessionTree(
        basePath,
        this.normalizeSessionTreeShape(sessionTree),
      );
    });
  }
}
