/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { tSystem } from "../../i18n/system-text.js";
import { normalizeEmailConnectionInfo } from "./connection.js";

export async function executeSendEmail({ payload = {}, connectionInfo = {} } = {}) {
  const { createTransport } = await import("nodemailer");
  const normalizedConnectionInfo = normalizeEmailConnectionInfo(connectionInfo);
  const to = String(payload?.to || normalizedConnectionInfo.toEmail || "").trim();
  const cc = String(payload?.cc || "").trim();
  const bcc = String(payload?.bcc || "").trim();
  const subject = String(payload?.subject || "").trim();
  const text = String(payload?.text || "").trim();
  const html = String(payload?.html || "").trim();
  if (!to) {
    throw new Error(tSystem("connectors.email.sendToRequired"));
  }
  const transporter = createTransport({
    logger: false,
    debug: false,
    host: normalizedConnectionInfo.smtpHost,
    port: normalizedConnectionInfo.smtpPort,
    secure: normalizedConnectionInfo.smtpSecure,
    auth: {
      user: normalizedConnectionInfo.username,
      pass: normalizedConnectionInfo.password,
    },
  });
  const sendResult = await transporter.sendMail({
    from: String(payload?.from || normalizedConnectionInfo.fromEmail || normalizedConnectionInfo.username).trim(),
    to,
    ...(cc ? { cc } : {}),
    ...(bcc ? { bcc } : {}),
    ...(subject ? { subject } : {}),
    ...(text ? { text } : {}),
    ...(html ? { html } : {}),
  });
  return {
    action: "send",
    accepted: Array.isArray(sendResult?.accepted) ? sendResult.accepted : [],
    rejected: Array.isArray(sendResult?.rejected) ? sendResult.rejected : [],
    messageId: String(sendResult?.messageId || "").trim(),
    response: String(sendResult?.response || "").trim(),
  };
}
