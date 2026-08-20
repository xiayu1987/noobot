/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { randomUUID } from "node:crypto";
import { chmod, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { filePath as path, isPathWithinRoot } from "@noobot/path-resolver";
import {
  buildConnectorConnectionInfo,
  normalizeConnectorType,
  resolveConnectorDefinition,
} from "@noobot/connector-protocol";
import { writeFileAtomic } from "../../shared/storage/atomic-file-write.js";

const REGISTRY_FILE_NAME = "connector-registry.json";
const REGISTRY_VERSION = 1;

function normalizeUserId(userId = "") {
  const normalized = String(userId || "").trim();
  if (!normalized) throw new TypeError("connector owner userId is required");
  return normalized;
}

function normalizeStoredRecord(record = {}, { workspaceRoot = "" } = {}) {
  const connectorId = String(record.connectorId || "").trim();
  const ownerUserId = String(record.ownerUserId || "").trim();
  const name = String(record.name || "").trim();
  const type = normalizeConnectorType(record.type);
  const subType = String(record.subType || "")
    .trim()
    .toLowerCase();
  const definition = resolveConnectorDefinition(type, subType);
  if (!connectorId || !ownerUserId || !name || !definition) return null;
  const connectionInfo = buildConnectorConnectionInfo({
    type,
    subType,
    parameters: record.parameters,
  });
  const parameters = { ...connectionInfo };
  delete parameters.database_type;
  delete parameters.terminal_type;
  delete parameters.email_type;
  const ownerWorkspace = path.resolve(workspaceRoot, ownerUserId);
  for (const definitionField of definition.fields.filter(
    (item) => item.kind === "workspace_path",
  )) {
    const resolvedPath = path.resolve(
      ownerWorkspace,
      String(parameters[definitionField.name] || ""),
    );
    if (!isPathWithinRoot(ownerWorkspace, resolvedPath)) {
      throw new TypeError(
        `connector workspace path is outside user workspace: ${definitionField.name}`,
      );
    }
    parameters[definitionField.name] = resolvedPath;
  }
  return Object.freeze({
    connectorId,
    ownerUserId,
    name,
    type,
    subType: definition.subType,
    parameters: Object.freeze(parameters),
    createdAt: String(record.createdAt || "").trim(),
    updatedAt: String(record.updatedAt || "").trim(),
  });
}

function normalizePayload(payload = {}, options = {}) {
  const records = Array.isArray(payload?.connectors) ? payload.connectors : [];
  return {
    version: REGISTRY_VERSION,
    connectors: records.map((record) => normalizeStoredRecord(record, options)).filter(Boolean),
  };
}

export class UserConnectorRegistry {
  constructor({ workspaceRoot = "" } = {}) {
    this.workspaceRoot = path.resolve(String(workspaceRoot || "."));
    this.userLocks = new Map();
  }

  setWorkspaceRoot(workspaceRoot = "") {
    this.workspaceRoot = path.resolve(String(workspaceRoot || "."));
  }

  _registryPath(userId = "") {
    return path.join(
      this.workspaceRoot,
      normalizeUserId(userId),
      "runtime",
      "connectors",
      REGISTRY_FILE_NAME,
    );
  }

  async _read(userId = "") {
    try {
      return normalizePayload(JSON.parse(await readFile(this._registryPath(userId), "utf8")), {
        workspaceRoot: this.workspaceRoot,
      });
    } catch (error) {
      if (error?.code === "ENOENT") {
        return normalizePayload({}, { workspaceRoot: this.workspaceRoot });
      }
      throw error;
    }
  }

  async _write(userId = "", payload = {}) {
    const registryPath = this._registryPath(userId);
    await mkdir(path.dirname(registryPath), { recursive: true });
    const normalized = normalizePayload(payload, { workspaceRoot: this.workspaceRoot });
    await writeFileAtomic({
      filePath: registryPath,
      content: `${JSON.stringify(normalized, null, 2)}\n`,
      writeFile: (temporaryPath, content) =>
        writeFile(temporaryPath, content, { encoding: "utf8", mode: 0o600 }),
      rename,
      remove: rm,
    });
    await chmod(registryPath, 0o600);
  }

  async _withUserLock(userId = "", operation) {
    const ownerUserId = normalizeUserId(userId);
    const previous = this.userLocks.get(ownerUserId) || Promise.resolve();
    const current = previous.then(operation, operation);
    this.userLocks.set(ownerUserId, current);
    try {
      return await current;
    } finally {
      if (this.userLocks.get(ownerUserId) === current) this.userLocks.delete(ownerUserId);
    }
  }

  async list(userId = "") {
    return (await this._read(normalizeUserId(userId))).connectors;
  }

  async get({ userId = "", connectorId = "" } = {}) {
    const normalizedId = String(connectorId || "").trim();
    return (await this.list(userId)).find((item) => item.connectorId === normalizedId) || null;
  }

  async create({ userId = "", name = "", type = "", subType = "", parameters = {} } = {}) {
    const ownerUserId = normalizeUserId(userId);
    const normalizedName = String(name || "").trim();
    if (!normalizedName) throw new TypeError("connector name is required");
    return this._withUserLock(ownerUserId, async () => {
      const payload = await this._read(ownerUserId);
      if (payload.connectors.some((item) => item.name === normalizedName))
        throw new TypeError(`connector name already exists: ${normalizedName}`);
      const now = new Date().toISOString();
      const record = normalizeStoredRecord(
        {
          connectorId: `con_${randomUUID()}`,
          ownerUserId,
          name: normalizedName,
          type,
          subType,
          parameters,
          createdAt: now,
          updatedAt: now,
        },
        { workspaceRoot: this.workspaceRoot },
      );
      if (!record) throw new TypeError("connector type or subtype is invalid");
      await this._write(ownerUserId, { connectors: [...payload.connectors, record] });
      return record;
    });
  }

  async update({
    userId = "",
    connectorId = "",
    name = "",
    type = "",
    subType = "",
    parameters = {},
  } = {}) {
    const ownerUserId = normalizeUserId(userId);
    const normalizedId = String(connectorId || "").trim();
    return this._withUserLock(ownerUserId, async () => {
      const payload = await this._read(ownerUserId);
      const index = payload.connectors.findIndex((item) => item.connectorId === normalizedId);
      if (index < 0) return null;
      const previous = payload.connectors[index];
      const record = normalizeStoredRecord(
        {
          connectorId: previous.connectorId,
          ownerUserId,
          name,
          type,
          subType,
          parameters,
          createdAt: previous.createdAt,
          updatedAt: new Date().toISOString(),
        },
        { workspaceRoot: this.workspaceRoot },
      );
      if (!record) throw new TypeError("connector type or subtype is invalid");
      if (
        payload.connectors.some(
          (item, itemIndex) => itemIndex !== index && item.name === record.name,
        )
      )
        throw new TypeError(`connector name already exists: ${record.name}`);
      const connectors = [...payload.connectors];
      connectors[index] = record;
      await this._write(ownerUserId, { connectors });
      return record;
    });
  }

  async delete({ userId = "", connectorId = "" } = {}) {
    const ownerUserId = normalizeUserId(userId);
    const normalizedId = String(connectorId || "").trim();
    return this._withUserLock(ownerUserId, async () => {
      const payload = await this._read(ownerUserId);
      const connectors = payload.connectors.filter((item) => item.connectorId !== normalizedId);
      if (connectors.length === payload.connectors.length) return false;
      await this._write(ownerUserId, { connectors });
      return true;
    });
  }
}

let globalRegistry = null;

export function initConnectorRegistry({ workspaceRoot = "" } = {}) {
  if (!globalRegistry) globalRegistry = new UserConnectorRegistry({ workspaceRoot });
  else if (workspaceRoot) globalRegistry.setWorkspaceRoot(workspaceRoot);
  return globalRegistry;
}

export function getConnectorRegistry({ required = true } = {}) {
  if (!globalRegistry && required) throw new Error("connector registry is not initialized");
  return globalRegistry;
}
