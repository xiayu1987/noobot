/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import { normalizeEmailConnectionInfo } from "../../../../src/system-core/connectors/emails/connection.js";

test("normalizeEmailConnectionInfo with full info (snake_case keys)", () => {
  const info = {
    username: "user@example.com",
    password: "secret",
    smtp_host: "smtp.example.com",
    smtp_port: 587,
    smtp_secure: false,
    imap_host: "imap.example.com",
    imap_port: 993,
    imap_secure: true,
    from_email: "sender@example.com",
    to_email: "recipient@example.com",
  };
  const result = normalizeEmailConnectionInfo(info);
  assert.equal(result.username, "user@example.com");
  assert.equal(result.smtpHost, "smtp.example.com");
  assert.equal(result.smtpPort, 587);
  assert.equal(result.smtpSecure, false);
  assert.equal(result.imapHost, "imap.example.com");
  assert.equal(result.imapPort, 993);
  assert.equal(result.imapSecure, true);
  assert.equal(result.fromEmail, "sender@example.com");
  assert.equal(result.toEmail, "recipient@example.com");
});

test("normalizeEmailConnectionInfo defaults for missing ports", () => {
  const result = normalizeEmailConnectionInfo({
    username: "user",
    password: "pass",
    smtp_host: "smtp.test.com",
    imap_host: "imap.test.com",
  });
  assert.equal(result.smtpPort, 587);
  assert.equal(result.smtpSecure, false);
  assert.equal(result.imapPort, 993);
  assert.equal(result.imapSecure, true);
});

test("normalizeEmailConnectionInfo throws on missing username/password", () => {
  assert.throws(
    () => normalizeEmailConnectionInfo({}),
    /username\/password/,
  );
});

test("normalizeEmailConnectionInfo throws on missing hosts", () => {
  assert.throws(
    () => normalizeEmailConnectionInfo({ username: "u", password: "p" }),
    /smtp_host\/imap_host/,
  );
});

test("normalizeEmailConnectionInfo throws on null input", () => {
  assert.throws(
    () => normalizeEmailConnectionInfo(null),
    /username\/password/,
  );
});

test("normalizeEmailConnectionInfo fromEmail defaults to username", () => {
  const result = normalizeEmailConnectionInfo({
    username: "myuser@test.com",
    password: "pass",
    smtp_host: "smtp.test.com",
    imap_host: "imap.test.com",
  });
  assert.equal(result.fromEmail, "myuser@test.com");
});
