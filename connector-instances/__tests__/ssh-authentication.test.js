/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, randomUUID } from "node:crypto";
import { once } from "node:events";
import ssh2 from "ssh2";
import { normalizeConnectorParameters, projectPublicConnector } from "@noobot/connector-protocol";
import { SSH_DEFINITION } from "../src/definitions.js";
import { closeSshChannel, executeSshCommand } from "../src/terminal/ssh-connector-channel.js";

const { privateKey: hostKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  privateKeyEncoding: { type: "pkcs1", format: "pem" },
  publicKeyEncoding: { type: "spki", format: "pem" },
});
const clientKey = generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey;
const privateKey = clientKey.export({ type: "pkcs1", format: "pem" });
const passphrase = " test key passphrase ";
const encryptedKey = clientKey.export({
  type: "pkcs1",
  format: "pem",
  cipher: "aes-256-cbc",
  passphrase,
});
const publicKey = ssh2.utils.parseKey(privateKey).getPublicSSH();

async function withServer(run) {
  const methods = [];
  const clients = new Set();
  const server = new ssh2.Server({ hostKeys: [hostKey] }, (client) => {
    clients.add(client);
    client.on("close", () => clients.delete(client));
    client.on("error", () => {});
    client.on("authentication", (context) => {
      methods.push(context.method);
      if (context.username !== "test-user") return context.reject();
      if (context.method === "password" && context.password === "test-password") {
        return context.accept();
      }
      if (context.method === "publickey" && context.key.data.equals(publicKey)) {
        if (!context.signature) return context.accept();
        const parsedKey = ssh2.utils.parseKey(privateKey);
        if (parsedKey.verify(context.blob, context.signature, context.hashAlgo))
          return context.accept();
      }
      context.reject();
    });
    client.on("ready", () =>
      client.on("session", (acceptSession) => {
        const session = acceptSession();
        session.on("pty", (acceptPty) => acceptPty());
        session.on("shell", (acceptShell) => {
          const stream = acceptShell();
          let input = "";
          stream.on("data", (chunk) => {
            input += chunk.toString();
            const token = input.match(/__NOOBOT_DONE_' '([^']+)__'/)?.[1];
            if (token && input.endsWith("\n")) {
              stream.write(`__NOOBOT_BEGIN_${token}__\nconnected\n__NOOBOT_DONE_${token}__0\n`);
              input = "";
            }
          });
        });
      }),
    );
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  try {
    await run({ host: "127.0.0.1", port: server.address().port, username: "test-user" }, methods);
  } finally {
    for (const client of clients) client.end();
    await new Promise((resolve) => server.close(resolve));
  }
}

for (const [name, credentials] of [
  ["password", { password: "test-password" }],
  ["private key without password", { privateKey }],
  ["encrypted private key", { privateKey: encryptedKey, passphrase }],
  ["private key takes priority over password", { privateKey, password: "incorrect" }],
]) {
  test(`SSH authenticates using ${name} and executes a command`, { timeout: 10000 }, async () => {
    await withServer(async (connection, methods) => {
      const channelKey = randomUUID();
      try {
        const connectionInfo = normalizeConnectorParameters(SSH_DEFINITION, {
          ...connection,
          ...credentials,
        });
        const result = await executeSshCommand({
          command: "echo connected",
          connectionInfo,
          channelKey,
        });
        assert.deepEqual(result, {
          ok: true,
          output: { stdout: "connected", stderr: "", exitCode: 0 },
        });
        assert.ok(methods.includes(credentials.privateKey ? "publickey" : "password"));
        if (credentials.privateKey) assert.ok(!methods.includes("password"));
      } finally {
        closeSshChannel({ channelKey });
      }
    });
  });
}

test("SSH rejects missing credentials before connecting", async () => {
  const result = await executeSshCommand({
    command: "true",
    channelKey: randomUUID(),
    connectionInfo: { host: "localhost", username: "test-user" },
  });
  assert.equal(result.ok, false);
  assert.match(result.error, /password or private key/);
});

test("SSH rejects invalid keys and incorrect passphrases without leaking credentials", async () => {
  for (const credentials of [
    { privateKey: "invalid-private-key" },
    { privateKey: encryptedKey, passphrase: "incorrect-passphrase" },
    { privateKey: encryptedKey },
  ]) {
    const channelKey = randomUUID();
    const result = await executeSshCommand({
      command: "true",
      channelKey,
      connectionInfo: { host: "127.0.0.1", username: "test-user", ...credentials },
    });
    assert.equal(result.ok, false);
    assert.ok(!JSON.stringify(result).includes(credentials.privateKey));
    if (credentials.passphrase) assert.ok(!JSON.stringify(result).includes(credentials.passphrase));
    closeSshChannel({ channelKey });
  }
});

test("SSH preserves multiline secrets and excludes them from public projections", () => {
  const parameters = normalizeConnectorParameters(SSH_DEFINITION, {
    host: "localhost",
    username: "test-user",
    privateKey: encryptedKey,
    passphrase,
  });
  assert.equal(parameters.privateKey, encryptedKey);
  assert.equal(parameters.passphrase, passphrase);
  assert.equal(SSH_DEFINITION.fields.find((field) => field.name === "privateKey").secret, true);
  assert.equal(SSH_DEFINITION.fields.find((field) => field.name === "passphrase").secret, true);
  const projected = JSON.stringify(projectPublicConnector({ parameters }, {}, SSH_DEFINITION));
  assert.ok(!projected.includes(encryptedKey));
  assert.ok(!projected.includes(passphrase));
});
