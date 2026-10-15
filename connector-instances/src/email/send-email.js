/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { normalizeEmailConnectionInfo } from "./connection.js";
import { text } from "@noobot/shared/value";

export async function executeSendEmail({ payload = {}, connectionInfo = {} } = {}) {
  const { createTransport } = await import("nodemailer");
  const normalizedConnectionInfo = normalizeEmailConnectionInfo(connectionInfo);
  const to = text(payload?.to || normalizedConnectionInfo.toEmail);
  const cc = text(payload?.cc);
  const bcc = text(payload?.bcc);
  const subject = text(payload?.subject);
  const normalizedText = text(payload?.text);
  const html = text(payload?.html);
  if (!to) {
    throw new Error("Email recipient is required");
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
  let sendResult;
  try {
    sendResult = await transporter.sendMail({
      from: String(
        payload?.from || normalizedConnectionInfo.fromEmail || normalizedConnectionInfo.username,
      ).trim(),
      to,
      ...(cc ? { cc } : {}),
      ...(bcc ? { bcc } : {}),
      ...(subject ? { subject } : {}),
      ...(normalizedText ? { text: normalizedText } : {}),
      ...(html ? { html } : {}),
    });
  } finally {
    transporter.close();
  }
  return {
    action: "send",
    accepted: Array.isArray(sendResult?.accepted) ? sendResult.accepted : [],
    rejected: Array.isArray(sendResult?.rejected) ? sendResult.rejected : [],
    messageId: text(sendResult?.messageId),
    response: text(sendResult?.response),
  };
}
