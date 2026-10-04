/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

function trimText(value) {
  return String(value || "").trim();
}

export function normalizeEmailConnectionInfo(connectionInfo = {}) {
  const info = connectionInfo && typeof connectionInfo === "object" ? connectionInfo : {};
  const username = trimText(info.username);
  const password = trimText(info.password);
  const smtpHost = trimText(info.smtp_host);
  const imapHost = trimText(info.imap_host);
  const smtpPort = Number(info.smtp_port || 587);
  const imapPort = Number(info.imap_port || 993);
  const smtpSecure = info.smtp_secure === true;
  const imapSecure = info.imap_secure !== false;
  const fromEmail = trimText(info.from_email || username);
  const toEmail = trimText(info.to_email);

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
    toEmail,
  };
}

export function createImapClient(ImapFlow, normalizedConnectionInfo) {
  return new ImapFlow({
    logger: false,
    host: normalizedConnectionInfo.imapHost,
    port: normalizedConnectionInfo.imapPort,
    secure: normalizedConnectionInfo.imapSecure,
    auth: {
      user: normalizedConnectionInfo.username,
      pass: normalizedConnectionInfo.password,
    },
  });
}
