/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { readFile } from "node:fs/promises";
import { ensurePrivateStorageDirectory } from "@noobot/platform-compatibility/private-storage";
import { filePath as path } from "@noobot/path-resolver";
import {
  CONNECTOR_INSTANCE_REGISTRY_VERSION as REGISTRY_VERSION,
  requireConnectorInstanceRecord,
  requireConnectorInstanceRegistry,
  requireLegacyConnectorInstanceRegistry,
  requireConnectorInstanceRegistryMigration,
} from "@noobot/connector-protocol";
import { WORKSPACE_LAYOUT } from "@noobot/workspace-protocol";
import {
  createDurableFilePublisher,
  ensureDurableStorageDirectory,
} from "../../shared/storage/durable-file.js";
import { SessionMutationCoordinator } from "../session-mutation-coordinator.js";
import { text } from "@noobot/shared/value";

const REGISTRY_FILE_NAME = "connector-instances.json";
const registryPublisher = createDurableFilePublisher((file) => `${file}.publication.tmp`, {
  exclusiveStage: true,
  mode: 0o600,
});

const requiredText = (value, label) => {
  const normalized = text(value);
  if (!normalized) throw new TypeError(`${label} is required`);
  return normalized;
};

export class FileSystemConnectorInstanceRepository {
  constructor({ workspaceRoot } = {}) {
    this.workspaceRoot = path.resolve(requiredText(workspaceRoot, "connector workspaceRoot"));
    this.mutationCoordinator = new SessionMutationCoordinator();
  }

  _registryPath(userId = "") {
    return path.join(
      this.workspaceRoot,
      requiredText(userId, "connector owner userId"),
      WORKSPACE_LAYOUT.CONNECTORS_DIR,
      REGISTRY_FILE_NAME,
    );
  }

  async _read(userId = "") {
    try {
      return requireConnectorInstanceRegistry(
        JSON.parse(await readFile(this._registryPath(userId), "utf8")),
        userId,
      );
    } catch (error) {
      if (error?.code === "ENOENT") return { version: REGISTRY_VERSION, connectors: [] };
      throw error;
    }
  }

  async _readLegacy(userId = "") {
    const payload = JSON.parse(await readFile(this._registryPath(userId), "utf8"));
    if (payload?.version === REGISTRY_VERSION) {
      requireConnectorInstanceRegistry(payload, userId);
      return null;
    }
    return requireLegacyConnectorInstanceRegistry(payload, userId);
  }

  async _write(userId = "", payload = {}) {
    const registryPath = this._registryPath(userId);
    const normalized = requireConnectorInstanceRegistry(
      { ...payload, version: REGISTRY_VERSION },
      userId,
    );
    await registryPublisher.writeDurableReplacement(
      registryPath,
      `${JSON.stringify(normalized, null, 2)}\n`,
    );
  }

  async _withUserLock(userId = "", operation) {
    const ownerUserId = requiredText(userId, "connector owner userId");
    const registryPath = this._registryPath(ownerUserId);
    await ensureDurableStorageDirectory(path.dirname(registryPath));
    return this.mutationCoordinator.run(`${registryPath}.lock`, async () => {
      await ensurePrivateStorageDirectory(path.dirname(registryPath), [
        REGISTRY_FILE_NAME,
        `${REGISTRY_FILE_NAME}.publication.tmp`,
      ]);
      return operation();
    });
  }

  async list(userId = "") {
    return this._withUserLock(userId, async () => (await this._read(userId)).connectors);
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
      const record = requireConnectorInstanceRecord(
        {
          connectorId: requiredText(connectorId, "connectorId"),
          ownerUserId,
          name: normalizedName,
          instanceType: requiredText(instanceType, "connector instanceType"),
          sealedParameters,
          createdAt: requiredText(now, "connector creation time"),
          updatedAt: now,
        },
        ownerUserId,
      );
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
      const record = requireConnectorInstanceRecord(
        {
          connectorId: normalizedId,
          ownerUserId,
          name: requiredText(name, "connector name"),
          instanceType: requiredText(instanceType, "connector instanceType"),
          sealedParameters,
          createdAt: previous.createdAt,
          updatedAt: requiredText(now, "connector update time"),
        },
        ownerUserId,
      );
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
    return this._withUserLock(userId, async () => {
      try {
        return await this._readLegacy(userId);
      } catch (error) {
        if (error?.code === "ENOENT") return null;
        throw error;
      }
    });
  }

  async migrateLegacy({ userId = "", connectors = [] } = {}) {
    const ownerUserId = requiredText(userId, "connector owner userId");
    return this._withUserLock(ownerUserId, async () => {
      const legacy = await this._readLegacy(ownerUserId);
      if (!legacy) throw new TypeError("connector registry is not a version 2 migration source");
      const normalized = requireConnectorInstanceRegistryMigration(legacy, connectors, ownerUserId);
      await this._write(ownerUserId, { connectors: normalized });
      return normalized;
    });
  }
}
