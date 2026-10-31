/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { filePath as path, isPathWithinRoot } from "@noobot/path-resolver";
import { randomUUID } from "node:crypto";
import {
  CONNECTOR_STATUS,
  createConnectorConnectionResult,
  normalizeConnectorAccessContext,
  normalizeConnectorAccessRequest,
  normalizeConnectorAccessResult,
  normalizeConnectorHealthResult,
  CONNECTOR_FAILURE_CODE,
  normalizeConnectorParameters,
  projectPublicConnector,
} from "@noobot/connector-protocol";
import { ConnectorInstanceRegistry } from "./instance-registry.js";
import { text } from "@noobot/shared/value";

const requiredText = (value, label) => {
  const normalized = text(value);
  if (!normalized) throw new TypeError(`${label} is required`);
  return normalized;
};

const CALLER_INPUT_STATUS_CODE = 400;

function decodeCallerInput(decode) {
  try {
    return decode();
  } catch (error) {
    if (error instanceof Error && error.statusCode === undefined) {
      error.statusCode = CALLER_INPUT_STATUS_CODE;
    }
    throw error;
  }
}

function callerInputError(message) {
  return Object.assign(new TypeError(message), { statusCode: CALLER_INPUT_STATUS_CODE });
}

function connectFailureMessage(failure) {
  if (!(failure instanceof Error)) throw failure;
  return failure.message;
}

export class ConnectorRuntime {
  constructor({
    repository,
    secretStore,
    workspaceRoot,
    resolveUserWorkspacePath = null,
    now = () => new Date().toISOString(),
  } = {}) {
    if (!repository) throw new TypeError("connector repository is required");
    if (!secretStore) throw new TypeError("connector secret store is required");
    this.repository = repository;
    this.secretStore = secretStore;
    if (!path.isAbsolute(String(workspaceRoot || ""))) {
      throw new TypeError("connector runtime workspaceRoot must be an absolute path");
    }
    this.workspaceRoot = workspaceRoot;
    this.resolveUserWorkspacePath = resolveUserWorkspacePath;
    this.now = now;
    this.registry = new ConnectorInstanceRegistry();
    this.handles = new Map();
    this.statuses = new Map();
    this.connectorLocks = new Map();
  }

  register(implementation = {}) {
    return this.registry.register(implementation);
  }

  listRegisteredInstances() {
    return this.registry.list();
  }

  _key(userId, connectorId) {
    return `${requiredText(userId, "connector owner userId")}::${requiredText(connectorId, "connectorId")}`;
  }

  async _withConnectorLock(key, operation) {
    const previous = this.connectorLocks.get(key) || Promise.resolve();
    const current = previous.then(operation, operation);
    this.connectorLocks.set(key, current);
    try {
      return await current;
    } finally {
      if (this.connectorLocks.get(key) === current) this.connectorLocks.delete(key);
    }
  }

  async _disconnectActive(key, context = {}) {
    const active = this.handles.get(key);
    try {
      if (active) {
        await active.implementation.dispose({
          handle: active.handle,
          connector: active.record,
          context,
        });
      }
      return Boolean(active);
    } finally {
      this.handles.delete(key);
      this.statuses.delete(key);
    }
  }

  _normalizeParameters(userId, definition, parameters) {
    const normalized = {
      ...decodeCallerInput(() => normalizeConnectorParameters(definition, parameters)),
    };
    const ownerUserId = decodeCallerInput(() => requiredText(userId, "connector owner userId"));
    const ownerWorkspace = path.resolve(
      typeof this.resolveUserWorkspacePath === "function"
        ? this.resolveUserWorkspacePath(ownerUserId)
        : path.resolve(this.workspaceRoot, ownerUserId),
    );
    for (const field of definition.fields.filter((item) => item.kind === "workspace_path")) {
      const resolvedPath = path.resolve(ownerWorkspace, normalized[field.name]);
      if (!isPathWithinRoot(ownerWorkspace, resolvedPath)) {
        throw callerInputError(`connector workspace path is outside user workspace: ${field.name}`);
      }
      normalized[field.name] = resolvedPath;
    }
    return Object.freeze(normalized);
  }

  async createConnector({ userId = "", name = "", instanceType = "", parameters = {} } = {}) {
    const ownerUserId = decodeCallerInput(() => requiredText(userId, "connector owner userId"));
    const implementation = decodeCallerInput(() => this.registry.require(instanceType));
    const connectorId = `con_${randomUUID()}`;
    const normalizedParameters = this._normalizeParameters(
      ownerUserId,
      implementation.definition,
      parameters,
    );
    const connectorName = decodeCallerInput(() => requiredText(name, "connector name"));
    const record = await this.repository.create({
      userId: ownerUserId,
      connectorId,
      name: connectorName,
      instanceType: implementation.definition.instanceType,
      sealedParameters: this.secretStore.seal({
        userId: ownerUserId,
        connectorId,
        instanceType: implementation.definition.instanceType,
        parameters: normalizedParameters,
      }),
      now: this.now(),
    });
    return Object.freeze({ ...record, parameters: normalizedParameters });
  }

  async updateConnector({
    userId = "",
    connectorId = "",
    name = "",
    instanceType = "",
    parameters = {},
  } = {}) {
    const ownerUserId = decodeCallerInput(() => requiredText(userId, "connector owner userId"));
    const normalizedId = decodeCallerInput(() => requiredText(connectorId, "connectorId"));
    const implementation = decodeCallerInput(() => this.registry.require(instanceType));
    const key = this._key(ownerUserId, normalizedId);
    return this._withConnectorLock(key, async () => {
      await this._disconnectActive(key);
      return this.repository.update({
        userId: ownerUserId,
        connectorId: normalizedId,
        name: decodeCallerInput(() => requiredText(name, "connector name")),
        instanceType: implementation.definition.instanceType,
        sealedParameters: this.secretStore.seal({
          userId: ownerUserId,
          connectorId: normalizedId,
          instanceType: implementation.definition.instanceType,
          parameters: this._normalizeParameters(ownerUserId, implementation.definition, parameters),
        }),
        now: this.now(),
      });
    });
  }

  async deleteConnector({ userId = "", connectorId = "" } = {}) {
    const key = decodeCallerInput(() => this._key(userId, connectorId));
    return this._withConnectorLock(key, async () => {
      await this._disconnectActive(key);
      return this.repository.delete({ userId, connectorId });
    });
  }

  async _record(userId, connectorId) {
    const record = await this.repository.get({ userId, connectorId });
    if (!record) throw callerInputError("connector not found");
    if (record.ownerUserId !== text(userId)) {
      throw callerInputError("connector does not belong to current user");
    }
    return Object.freeze({
      ...record,
      parameters: this.secretStore.unseal({
        userId,
        connectorId: record.connectorId,
        instanceType: record.instanceType,
        sealedParameters: record.sealedParameters,
      }),
    });
  }

  async connect({ userId = "", connectorId = "", context = {} } = {}) {
    const key = decodeCallerInput(() => this._key(userId, connectorId));
    return this._withConnectorLock(key, async () => {
      const record = await this._record(userId, connectorId);
      await this._disconnectActive(key, context);
      const implementation = this.registry.require(record.instanceType);
      this.statuses.set(key, { status: CONNECTOR_STATUS.CONNECTING });
      let handle = null;
      try {
        handle = await implementation.create({ connector: record, context });
        const health = normalizeConnectorHealthResult(
          await implementation.health({ handle, connector: record, context }),
        );
        if (!health.ok) {
          try {
            await implementation.dispose({ handle, connector: record, context });
          } finally {
            handle = null;
          }
          this.statuses.set(key, {
            status: CONNECTOR_STATUS.ERROR,
            errorCode: health.code,
            statusMessage: health.error,
          });
          return createConnectorConnectionResult(this.getPublicConnector({ record }));
        }
        const connectedAt = this.now();
        this.handles.set(key, { handle, implementation, record });
        this.statuses.set(key, {
          status: CONNECTOR_STATUS.CONNECTED,
          connectedAt,
        });
        return createConnectorConnectionResult(this.getPublicConnector({ record }));
      } catch (error) {
        let failure = error;
        if (handle) {
          try {
            await implementation.dispose({ handle, connector: record, context });
          } catch (cleanupError) {
            failure = new AggregateError([error, cleanupError], "connector startup cleanup failed");
          }
        }
        this.statuses.set(key, {
          status: CONNECTOR_STATUS.ERROR,
          errorCode: CONNECTOR_FAILURE_CODE.CONNECT_FAILED,
          statusMessage: connectFailureMessage(failure),
        });
        return createConnectorConnectionResult(this.getPublicConnector({ record }));
      }
    });
  }

  async disconnect({ userId = "", connectorId = "", context = {} } = {}) {
    const key = decodeCallerInput(() => this._key(userId, connectorId));
    return this._withConnectorLock(key, () => this._disconnectActive(key, context));
  }

  async health({ userId = "", connectorId = "", context = {} } = {}) {
    const key = this._key(userId, connectorId);
    return this._withConnectorLock(key, async () => {
      const record = await this._record(userId, connectorId);
      const active = this.handles.get(key);
      if (!active) return this.getPublicConnector({ record });
      const health = normalizeConnectorHealthResult(
        await active.implementation.health({
          handle: active.handle,
          connector: record,
          context,
        }),
      );
      const { connectedAt } = this.statuses.get(key);
      this.statuses.set(
        key,
        health.ok
          ? { status: CONNECTOR_STATUS.CONNECTED, connectedAt }
          : {
              status: CONNECTOR_STATUS.ERROR,
              errorCode: health.code,
              statusMessage: health.error,
              connectedAt,
            },
      );
      return this.getPublicConnector({ record });
    });
  }

  async access({ userId = "", request = {}, context = {} } = {}) {
    const normalized = normalizeConnectorAccessRequest(request);
    const normalizedContext = normalizeConnectorAccessContext(context);
    const key = this._key(userId, normalized.connectorId);
    return this._withConnectorLock(key, async () => {
      const record = await this._record(userId, normalized.connectorId);
      const active = this.handles.get(key);
      if (!active) throw new TypeError("connector is not connected");
      if (
        !active.implementation.definition.operations.some(
          (operation) => operation.name === normalized.operation,
        )
      ) {
        throw new TypeError(`connector operation is not registered: ${normalized.operation}`);
      }
      return normalizeConnectorAccessResult(
        await active.implementation.access({
          handle: active.handle,
          connector: record,
          request: normalized,
          context: normalizedContext,
        }),
      );
    });
  }

  getPublicConnector({ record }) {
    const implementation = this.registry.require(record.instanceType);
    return projectPublicConnector(
      record,
      this.statuses.get(this._key(record.ownerUserId, record.connectorId)),
      implementation.definition,
    );
  }

  async listUserConnectors(userId = "") {
    return Promise.all(
      (await this.repository.list(userId)).map((record) => this.getPublicConnector({ record })),
    );
  }

  async releaseUser(userId = "") {
    const ownerUserId = requiredText(userId, "connector owner userId");
    const connectorIds = [...this.handles.keys()]
      .filter((key) => key.startsWith(`${ownerUserId}::`))
      .map((key) => key.slice(ownerUserId.length + 2));
    const released = await Promise.all(
      connectorIds.map((connectorId) => this.disconnect({ userId: ownerUserId, connectorId })),
    );
    this.secretStore.lockUser?.(ownerUserId);
    return { userId: ownerUserId, releasedCount: released.filter(Boolean).length };
  }

  async unlockUser({ userId = "", connectCode = "" } = {}) {
    const ownerUserId = requiredText(userId, "connector owner userId");
    await this.secretStore.unlockUser({ userId: ownerUserId, connectCode });
    const legacy = await this.repository.readLegacy?.(ownerUserId);
    if (!legacy) return;
    const connectors = legacy.connectors.map((record) => ({
      ...record,
      sealedParameters: this.secretStore.seal({
        userId: ownerUserId,
        connectorId: record.connectorId,
        instanceType: record.instanceType,
        parameters: record.parameters,
      }),
    }));
    await this.repository.migrateLegacy({ userId: ownerUserId, connectors });
  }

  async rotateUserConnectCode(payload = {}) {
    return this.secretStore.rotateUserKey(payload);
  }
}
