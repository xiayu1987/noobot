/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import test from "node:test";
import { createImapClient, normalizeEmailConnectionInfo } from "../src/email/connection.js";
import { readEmailSourceBuffer } from "../src/email/read-email.js";
import { executeEmailOperation } from "../src/email/email-connector-channel.js";

test("email connection normalization preserves explicit fields and defaults ports", () => {
  const normalized = normalizeEmailConnectionInfo({
    username: "user@example.com",
    password: "secret",
    smtp_host: "smtp.example.com",
    imap_host: "imap.example.com",
    to_email: "recipient@example.com",
  });
  assert.equal(normalized.smtpPort, 587);
  assert.equal(normalized.smtpSecure, false);
  assert.equal(normalized.imapPort, 993);
  assert.equal(normalized.imapSecure, true);
  assert.equal(normalized.fromEmail, "user@example.com");
  assert.equal(normalized.toEmail, "recipient@example.com");
});

test("email connection normalization rejects incomplete credentials and hosts", () => {
  assert.throws(() => normalizeEmailConnectionInfo(null), /username and password/);
  assert.throws(
    () => normalizeEmailConnectionInfo({ username: "user", password: "secret" }),
    /SMTP and IMAP hosts/,
  );
});

test("email operation rejects unknown operations without network access", async () => {
  const result = await executeEmailOperation({ operation: "delete" });
  assert.deepEqual(result, {
    ok: false,
    code: 1,
    stdout: "",
    stderr: "Email operation is invalid",
  });
});

test("email source buffer normalizes every supported source shape", async () => {
  const buffer = Buffer.from("raw");
  assert.equal((await readEmailSourceBuffer(null)).length, 0);
  assert.equal(await readEmailSourceBuffer(buffer), buffer);
  assert.equal((await readEmailSourceBuffer("text")).toString(), "text");
  assert.equal((await readEmailSourceBuffer(new Uint8Array([104, 105]))).toString(), "hi");
  const syncChunks = ["a", null, new Uint8Array([98]), Buffer.from("c")];
  assert.equal((await readEmailSourceBuffer(syncChunks)).toString(), "abc");
  async function* asyncChunks() {
    yield Buffer.from("x");
    yield "";
    yield 7;
  }
  assert.equal((await readEmailSourceBuffer(asyncChunks())).toString(), "x7");
  assert.equal((await readEmailSourceBuffer({ value: 1 })).toString(), "[object Object]");
});

test("imap client factory maps normalized connection fields", () => {
  const client = createImapClient(
    class {
      constructor(options) {
        this.options = options;
      }
    },
    { imapHost: "imap.example.com", imapPort: 993, imapSecure: true, username: "u", password: "p" },
  );
  assert.deepEqual(client.options, {
    logger: false,
    host: "imap.example.com",
    port: 993,
    secure: true,
    auth: { user: "u", pass: "p" },
  });
});
