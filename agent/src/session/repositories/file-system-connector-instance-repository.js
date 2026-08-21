/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { chmod, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { filePath as path } from "@noobot/path-resolver";
import { normalizeConnectorSecretEnvelope } from "@noobot/connector-protocol";
import { writeFileAtomic } from "../../shared/storage/atomic-file-write.js";

const REGISTRY_FILE_NAME = "connector-instances.json";
const REGISTRY_VERSION = 3;
const LEGACY_REGISTRY_VERSION = 2;

const requiredText = (value, label) => {
  const normalized = String(value || "").trim();
  if (!normalized) throw new TypeError(`${label} is required`);
  return normalized;
};

function normalizeRecord(record = {}) {
  const connectorId = String(record.connectorId || "").trim();
  const ownerUserId = String(record.ownerUserId || "").trim();
  const name = String(record.name || "").trim();
  const instanceType = String(record.instanceType || "").trim();
  const sealedParameters = normalizeConnectorSecretEnvelope(record.sealedParameters);
  if (!connectorId || !ownerUserId || !name || !instanceType) return null;
  return Object.freeze({
    connectorId,
    ownerUserId,
    name,
    instanceType,
    sealedParameters,
    createdAt: String(record.createdAt || "").trim(),
    updatedAt: String(record.updatedAt || "").trim(),
  });
}

function normalizePayload(payload = {}) {
  if (Number(payload?.version) !== REGISTRY_VERSION)
    throw new TypeError(`unsupported connector instance registry version: ${payload?.version}`);
  return {
    version: REGISTRY_VERSION,
    connectors: (Array.isArray(payload.connectors) ? payload.connectors : [])
      .map(normalizeRecord)
      .filter(Boolean),
  };
}

export class FileSystemConnectorInstanceRepository {
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
      requiredText(userId, "connector owner userId"),
      "runtime",
      "connectors",
      REGISTRY_FILE_NAME,
    );
  }

  async _read(userId = "") {
    try {
      return normalizePayload(JSON.parse(await readFile(this._registryPath(userId), "utf8")));
    } catch (error) {
      if (error?.code === "ENOENT") return { version: REGISTRY_VERSION, connectors: [] };
      throw error;
    }
  }

  async _readLegacy(userId = "") {
    const payload = JSON.parse(await readFile(this._registryPath(userId), "utf8"));
    if (Number(payload?.version) !== LEGACY_REGISTRY_VERSION) return null;
    return {
      version: LEGACY_REGISTRY_VERSION,
      connectors: (Array.isArray(payload.connectors) ? payload.connectors : []).map((record) => ({
        connectorId: requiredText(record?.connectorId, "legacy connectorId"),
        ownerUserId: requiredText(record?.ownerUserId, "legacy connector ownerUserId"),
        name: requiredText(record?.name, "legacy connector name"),
        instanceType: requiredText(record?.instanceType, "legacy connector instanceType"),
        parameters:
          record?.parameters &&
          typeof record.parameters === "object" &&
          !Array.isArray(record.parameters)
            ? Object.freeze({ ...record.parameters })
            : Object.freeze({}),
        createdAt: String(record?.createdAt || "").trim(),
        updatedAt: String(record?.updatedAt || "").trim(),
      })),
    };
  }

  async _write(userId = "", payload = {}) {
    const registryPath = this._registryPath(userId);
    await mkdir(path.dirname(registryPath), { recursive: true });
    const normalized = normalizePayload({ ...payload, version: REGISTRY_VERSION });
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
    const ownerUserId = requiredText(userId, "connector owner userId");
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
    return (await this._read(requiredText(userId, "connector owner userId"))).connectors;
  }

  async get({ userId = "", connectorId = "" } = {}) {
    const normalizedId = requiredText(connectorId, "connectorId");
    return (await this.list(userId)).find((item) => item.connectorId === normalizedId) || null;
  }

  async create({
    userId = "",
    connectorId = "",
    name = "",
    instanceType = "",
    sealedParameters,
    now = "",
  } = {}) {
    const ownerUserId = requiredText(userId, "connector owner userId");
    const normalizedName = requiredText(name, "connector name");
    return this._withUserLock(ownerUserId, async () => {
      const payload = await this._read(ownerUserId);
      if (payload.connectors.some((item) => item.name === normalizedName)) {
        throw new TypeError(`connector name already exists: ${normalizedName}`);
      }
      const record = normalizeRecord({
        connectorId: requiredText(connectorId, "connectorId"),
        ownerUserId,
        name: normalizedName,
        instanceType: requiredText(instanceType, "connector instanceType"),
        sealedParameters,
        createdAt: requiredText(now, "connector creation time"),
        updatedAt: now,
      });
      await this._write(ownerUserId, { connectors: [...payload.connectors, record] });
      return record;
    });
  }

  async update({
    userId = "",
    connectorId = "",
    name = "",
    instanceType = "",
    sealedParameters,
    now = "",
  } = {}) {
    const ownerUserId = requiredText(userId, "connector owner userId");
    const normalizedId = requiredText(connectorId, "connectorId");
    return this._withUserLock(ownerUserId, async () => {
      const payload = await this._read(ownerUserId);
      const index = payload.connectors.findIndex((item) => item.connectorId === normalizedId);
      if (index < 0) return null;
      const previous = payload.connectors[index];
      const record = normalizeRecord({
        connectorId: normalizedId,
        ownerUserId,
        name: requiredText(name, "connector name"),
        instanceType: requiredText(instanceType, "connector instanceType"),
        sealedParameters,
        createdAt: previous.createdAt,
        updatedAt: requiredText(now, "connector update time"),
      });
      if (
        payload.connectors.some(
          (item, itemIndex) => itemIndex !== index && item.name === record.name,
        )
      ) {
        throw new TypeError(`connector name already exists: ${record.name}`);
      }
      const connectors = [...payload.connectors];
      connectors[index] = record;
      await this._write(ownerUserId, { connectors });
      return record;
    });
  }

  async delete({ userId = "", connectorId = "" } = {}) {
    const ownerUserId = requiredText(userId, "connector owner userId");
    const normalizedId = requiredText(connectorId, "connectorId");
    return this._withUserLock(ownerUserId, async () => {
      const payload = await this._read(ownerUserId);
      const connectors = payload.connectors.filter((item) => item.connectorId !== normalizedId);
      if (connectors.length === payload.connectors.length) return false;
      await this._write(ownerUserId, { connectors });
      return true;
    });
  }

  async readLegacy(userId = "") {
    try {
      return await this._readLegacy(requiredText(userId, "connector owner userId"));
    } catch (error) {
      if (error?.code === "ENOENT") return null;
      throw error;
    }
  }

  async migrateLegacy({ userId = "", connectors = [] } = {}) {
    const ownerUserId = requiredText(userId, "connector owner userId");
    return this._withUserLock(ownerUserId, async () => {
      const legacy = await this._readLegacy(ownerUserId);
      if (!legacy) throw new TypeError("connector registry is not a version 2 migration source");
      const normalized = connectors.map(normalizeRecord);
      if (normalized.some((record) => !record)) {
        throw new TypeError("connector registry migration contains invalid records");
      }
      await this._write(ownerUserId, { connectors: normalized });
      return normalized;
    });
  }
}
