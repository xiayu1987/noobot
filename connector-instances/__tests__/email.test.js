/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import test from "node:test";
import { normalizeEmailConnectionInfo } from "../src/email/connection.js";
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
