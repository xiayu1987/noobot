/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { createCipheriv, createDecipheriv, randomBytes, scrypt as deriveKey } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { writeFileAtomic } from "@noobot/platform-compatibility/atomic-file-write";
import {
  CONNECTOR_SECRET_ALGORITHM,
  CONNECTOR_SECRET_ENVELOPE_VERSION,
  CONNECTOR_SECRET_KDF,
  createConnectorSecretAad,
  normalizeConnectorSecretEnvelope,
} from "@noobot/connector-protocol";

const scrypt = promisify(deriveKey);
const KEY_DOCUMENT_VERSION = 1;
const KEY_FILE_NAME = "connector-key.json";
const KEY_BYTES = 32;
const IV_BYTES = 12;
const SALT_BYTES = 16;

const requiredText = (value, label) => {
  const normalized = String(value || "").trim();
  if (!normalized) throw new TypeError(`${label} is required`);
  return normalized;
};

function connectorSecretError(code, cause = null) {
  const error = new Error(code, cause ? { cause } : undefined);
  error.code = code;
  return error;
}

async function deriveKek(connectCode, salt) {
  return scrypt(requiredText(connectCode, "connectCode"), salt, KEY_BYTES, {
    N: 131_072,
    r: 8,
    p: 1,
    maxmem: 256 * 1024 * 1024,
  });
}

function encryptBytes({ key, plaintext, aad }) {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(CONNECTOR_SECRET_ALGORITHM, key, iv);
  cipher.setAAD(Buffer.from(aad, "utf8"));
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return {
    version: CONNECTOR_SECRET_ENVELOPE_VERSION,
    algorithm: CONNECTOR_SECRET_ALGORITHM,
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
    ciphertext: ciphertext.toString("base64"),
  };
}

function decryptBytes({ key, envelope, aad }) {
  const normalized = normalizeConnectorSecretEnvelope(envelope);
  const decipher = createDecipheriv(
    normalized.algorithm,
    key,
    Buffer.from(normalized.iv, "base64"),
  );
  decipher.setAAD(Buffer.from(aad, "utf8"));
  decipher.setAuthTag(Buffer.from(normalized.tag, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(normalized.ciphertext, "base64")),
    decipher.final(),
  ]);
}

function keyAad(userId) {
  return JSON.stringify({ protocol: "noobot.connector.user-key", version: 1, userId });
}

function normalizeKeyDocument(input = {}) {
  if (Number(input?.version) !== KEY_DOCUMENT_VERSION) {
    throw connectorSecretError("connector_secret_key_document_invalid");
  }
  if (String(input?.kdf || "") !== CONNECTOR_SECRET_KDF) {
    throw connectorSecretError("connector_secret_key_document_invalid");
  }
  return {
    version: KEY_DOCUMENT_VERSION,
    kdf: CONNECTOR_SECRET_KDF,
    salt: requiredText(input.salt, "connector key salt"),
    wrappedKey: normalizeConnectorSecretEnvelope(input.wrappedKey),
  };
}

export class ConnectorSecretVault {
  constructor({ workspaceRoot = "" } = {}) {
    this.workspaceRoot = path.resolve(String(workspaceRoot || "."));
    this.unlockedKeys = new Map();
    this.userLocks = new Map();
  }

  setWorkspaceRoot(workspaceRoot = "") {
    this.workspaceRoot = path.resolve(String(workspaceRoot || "."));
  }

  _keyPath(userId) {
    return path.join(
      this.workspaceRoot,
      requiredText(userId, "connector secret userId"),
      "runtime",
      "connectors",
      KEY_FILE_NAME,
    );
  }

  async _withUserLock(userId, operation) {
    const normalizedUserId = requiredText(userId, "connector secret userId");
    const previous = this.userLocks.get(normalizedUserId) || Promise.resolve();
    const current = previous.then(operation, operation);
    this.userLocks.set(normalizedUserId, current);
    try {
      return await current;
    } finally {
      if (this.userLocks.get(normalizedUserId) === current) this.userLocks.delete(normalizedUserId);
    }
  }

  async _writeKeyDocument(userId, document) {
    const keyPath = this._keyPath(userId);
    await mkdir(path.dirname(keyPath), { recursive: true });
    await writeFileAtomic({
      filePath: keyPath,
      content: `${JSON.stringify(document, null, 2)}\n`,
      writeFile: (temporaryPath, content) =>
        writeFile(temporaryPath, content, { encoding: "utf8", mode: 0o600 }),
      rename,
      remove: rm,
    });
  }

  async _wrapUserKey(userId, connectCode, dataKey, salt = randomBytes(SALT_BYTES)) {
    const kek = await deriveKek(connectCode, salt);
    try {
      return {
        version: KEY_DOCUMENT_VERSION,
        kdf: CONNECTOR_SECRET_KDF,
        salt: salt.toString("base64"),
        wrappedKey: encryptBytes({ key: kek, plaintext: dataKey, aad: keyAad(userId) }),
      };
    } finally {
      kek.fill(0);
    }
  }

  async unlockUser({ userId = "", connectCode = "" } = {}) {
    const normalizedUserId = requiredText(userId, "connector secret userId");
    return this._withUserLock(normalizedUserId, async () => {
      let document;
      try {
        document = normalizeKeyDocument(
          JSON.parse(await readFile(this._keyPath(normalizedUserId), "utf8")),
        );
      } catch (error) {
        if (error?.code !== "ENOENT")
          throw connectorSecretError("connector_secret_unlock_failed", error);
        const dataKey = randomBytes(KEY_BYTES);
        document = await this._wrapUserKey(normalizedUserId, connectCode, dataKey);
        await this._writeKeyDocument(normalizedUserId, document);
        this.unlockedKeys.set(normalizedUserId, dataKey);
        return;
      }
      try {
        const kek = await deriveKek(connectCode, Buffer.from(document.salt, "base64"));
        try {
          const dataKey = decryptBytes({
            key: kek,
            envelope: document.wrappedKey,
            aad: keyAad(normalizedUserId),
          });
          this.unlockedKeys.get(normalizedUserId)?.fill(0);
          this.unlockedKeys.set(normalizedUserId, dataKey);
        } finally {
          kek.fill(0);
        }
      } catch (error) {
        throw connectorSecretError("connector_secret_unlock_failed", error);
      }
    });
  }

  _requireKey(userId) {
    const normalizedUserId = requiredText(userId, "connector secret userId");
    const key = this.unlockedKeys.get(normalizedUserId);
    if (!key) throw connectorSecretError("connector_secret_locked");
    return { userId: normalizedUserId, key };
  }

  seal({ userId = "", connectorId = "", instanceType = "", parameters = {} } = {}) {
    const unlocked = this._requireKey(userId);
    const aad = createConnectorSecretAad({
      userId: unlocked.userId,
      connectorId,
      instanceType,
    });
    return Object.freeze(
      encryptBytes({
        key: unlocked.key,
        plaintext: Buffer.from(JSON.stringify(parameters), "utf8"),
        aad,
      }),
    );
  }

  unseal({ userId = "", connectorId = "", instanceType = "", sealedParameters } = {}) {
    const unlocked = this._requireKey(userId);
    try {
      const plaintext = decryptBytes({
        key: unlocked.key,
        envelope: sealedParameters,
        aad: createConnectorSecretAad({
          userId: unlocked.userId,
          connectorId,
          instanceType,
        }),
      });
      const parameters = JSON.parse(plaintext.toString("utf8"));
      if (!parameters || typeof parameters !== "object" || Array.isArray(parameters)) {
        throw new TypeError("connector parameters payload must be an object");
      }
      return Object.freeze({ ...parameters });
    } catch (error) {
      throw connectorSecretError("connector_secret_decrypt_failed", error);
    }
  }

  async rotateUserKey({ userId = "", oldConnectCode = "", newConnectCode = "" } = {}) {
    const normalizedUserId = requiredText(userId, "connector secret userId");
    await this.unlockUser({ userId: normalizedUserId, connectCode: oldConnectCode });
    await this._withUserLock(normalizedUserId, async () => {
      const dataKey = this._requireKey(normalizedUserId).key;
      await this._writeKeyDocument(
        normalizedUserId,
        await this._wrapUserKey(normalizedUserId, newConnectCode, dataKey),
      );
    });
  }

  lockUser(userId = "") {
    const normalizedUserId = requiredText(userId, "connector secret userId");
    this.unlockedKeys.get(normalizedUserId)?.fill(0);
    this.unlockedKeys.delete(normalizedUserId);
  }
}
