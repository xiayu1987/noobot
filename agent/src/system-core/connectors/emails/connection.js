/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { tSystem } from "../../i18n/system-text.js";

export function normalizeEmailConnectionInfo(connectionInfo = {}) {
  const info = connectionInfo && typeof connectionInfo === "object" ? connectionInfo : {};
  const username = String(info?.username || "").trim();
  const password = String(info?.password || "").trim();
  const smtpHost = String(info?.smtp_host || "").trim();
  const imapHost = String(info?.imap_host || "").trim();
  const smtpPort = Number(info?.smtp_port || 587);
  const imapPort = Number(info?.imap_port || 993);
  const smtpSecure =
    String(info?.smtp_secure ?? "").trim() !== ""
      ? String(info?.smtp_secure).trim().toLowerCase() === "true" ||
        Number(info?.smtp_secure) === 1
      : smtpPort === 465;
  const imapSecure =
    String(info?.imap_secure ?? "").trim() !== ""
      ? String(info?.imap_secure).trim().toLowerCase() === "true" ||
        Number(info?.imap_secure) === 1
      : imapPort === 993;
  const fromEmail = String(info?.from_email || username).trim();
  const toEmail = String(info?.to_email || "").trim();

  if (!username || !password) {
    throw new Error(tSystem("connectors.email.usernamePasswordRequired"));
  }
  if (!smtpHost || !imapHost) {
    throw new Error(tSystem("connectors.email.smtpImapHostRequired"));
  }

  return {
    username,
    password,
    smtpHost,
    smtpPort: Number.isFinite(smtpPort) && smtpPort > 0 ? Math.floor(smtpPort) : 587,
    smtpSecure,
    imapHost,
    imapPort: Number.isFinite(imapPort) && imapPort > 0 ? Math.floor(imapPort) : 993,
    imapSecure,
    fromEmail,
    toEmail,
  };
}
