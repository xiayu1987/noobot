/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

export function normalizeEmailConnectionInfo(connectionInfo = {}) {
  const info = connectionInfo && typeof connectionInfo === "object" ? connectionInfo : {};
  const username = String(info?.username || "").trim();
  const password = String(info?.password || "").trim();
  const smtpHost = String(info?.smtp_host || "").trim();
  const imapHost = String(info?.imap_host || "").trim();
  const smtpPort = Number(info.smtp_port);
  const imapPort = Number(info.imap_port);
  const smtpSecure = info.smtp_secure === true;
  const imapSecure = info.imap_secure === true;
  const fromEmail = String(info?.from_email || username).trim();

  if (!username || !password) {
    throw new Error("Email username and password are required");
  }
  if (!smtpHost || !imapHost) {
    throw new Error("SMTP and IMAP hosts are required");
  }

  return {
    username,
    password,
    smtpHost,
    smtpPort,
    smtpSecure,
    imapHost,
    imapPort,
    imapSecure,
    fromEmail,
  };
}
