/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

function parseEmailCommand(command = "") {
  const normalizedCommand = String(command || "").trim();
  if (!normalizedCommand) {
    throw new Error("email command required");
  }
  let parsedCommand = null;
  try {
    parsedCommand = JSON.parse(normalizedCommand);
  } catch {
    throw new Error(
      "email command must be JSON string, e.g. {\"action\":\"send\",...}",
    );
  }
  if (!parsedCommand || typeof parsedCommand !== "object") {
    throw new Error("email command JSON object required");
  }
  const action = String(parsedCommand?.action || "").trim().toLowerCase();
  if (!["send", "list", "read"].includes(action)) {
    throw new Error("email command action must be send|list|read");
  }
  return { action, payload: parsedCommand };
}

function normalizeListPaging(payload = {}) {
  const page = Number(payload?.page || 1);
  const pageSize = Number(payload?.page_size || payload?.pageSize || 10);
  const normalizedPage =
    Number.isFinite(page) && page > 0 ? Math.floor(page) : 1;
  const normalizedPageSize =
    Number.isFinite(pageSize) && pageSize > 0
      ? Math.min(Math.floor(pageSize), 50)
      : 10;
  return {
    page: normalizedPage,
    pageSize: normalizedPageSize,
  };
}

function normalizeEmailConnectionInfo(connectionInfo = {}) {
  const info = connectionInfo && typeof connectionInfo === "object" ? connectionInfo : {};
  const username = String(info?.username || "").trim();
  const password = String(info?.password || "").trim();
  const smtpHost = String(info?.smtp_host || info?.smtpHost || "").trim();
  const imapHost = String(info?.imap_host || info?.imapHost || "").trim();
  const smtpPort = Number(info?.smtp_port || info?.smtpPort || 587);
  const imapPort = Number(info?.imap_port || info?.imapPort || 993);
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
  const fromEmail = String(info?.from_email || info?.fromEmail || username).trim();
  const toEmail = String(info?.to_email || info?.toEmail || "").trim();

  if (!username || !password) {
    throw new Error("email connector username/password required");
  }
  if (!smtpHost || !imapHost) {
    throw new Error("email connector smtp_host/imap_host required");
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

async function executeSendEmail({ payload = {}, connectionInfo = {} } = {}) {
  const { createTransport } = await import("nodemailer");
  const normalizedConnectionInfo = normalizeEmailConnectionInfo(connectionInfo);
  const to = String(payload?.to || normalizedConnectionInfo.toEmail || "").trim();
  const cc = String(payload?.cc || "").trim();
  const bcc = String(payload?.bcc || "").trim();
  const subject = String(payload?.subject || "").trim();
  const text = String(payload?.text || "").trim();
  const html = String(payload?.html || "").trim();
  if (!to) {
    throw new Error("email send action requires 'to' (or configure to_email in connector)");
  }
  const transporter = createTransport({
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

async function executeListEmail({ payload = {}, connectionInfo = {} } = {}) {
  const { ImapFlow } = await import("imapflow");
  const normalizedConnectionInfo = normalizeEmailConnectionInfo(connectionInfo);
  const folder = String(payload?.folder || "INBOX").trim() || "INBOX";
  const { page, pageSize } = normalizeListPaging(payload);
  const unseenOnly = payload?.unseen_only === true;

  const imapClient = new ImapFlow({
    host: normalizedConnectionInfo.imapHost,
    port: normalizedConnectionInfo.imapPort,
    secure: normalizedConnectionInfo.imapSecure,
    auth: {
      user: normalizedConnectionInfo.username,
      pass: normalizedConnectionInfo.password,
    },
  });

  await imapClient.connect();
  try {
    const mailboxLock = await imapClient.getMailboxLock(folder);
    try {
      const allUids = await imapClient.search(unseenOnly ? { seen: false } : {});
      const normalizedUids = (Array.isArray(allUids) ? allUids : [])
        .map((uid) => Number(uid || 0))
        .filter((uid) => Number.isFinite(uid) && uid > 0)
        .sort((leftUid, rightUid) => rightUid - leftUid);
      const totalCount = normalizedUids.length;
      const startIndex = (page - 1) * pageSize;
      const endIndex = startIndex + pageSize;
      const pageUids = normalizedUids.slice(startIndex, endIndex);
      if (!pageUids.length) {
        return {
          action: "list",
          folder,
          page,
          page_size: pageSize,
          total_count: totalCount,
          count: 0,
          messages: [],
        };
      }

      const messageSummaries = [];
      for await (const messageItem of imapClient.fetch(pageUids, {
        uid: true,
        envelope: true,
        internalDate: true,
      })) {
        messageSummaries.push({
          uid: Number(messageItem?.uid || 0),
          subject: String(messageItem?.envelope?.subject || "").trim(),
          from: Array.isArray(messageItem?.envelope?.from)
            ? messageItem.envelope.from.map((addressItem) =>
                `${String(addressItem?.name || "").trim()} <${String(
                  addressItem?.address || "",
                ).trim()}>`.trim(),
              )
            : [],
          date: String(messageItem?.internalDate || ""),
        });
      }
      const pagedMessages = messageSummaries.sort(
        (leftMessage, rightMessage) =>
          Number(rightMessage?.uid || 0) - Number(leftMessage?.uid || 0),
      );
      return {
        action: "list",
        folder,
        page,
        page_size: pageSize,
        total_count: totalCount,
        count: pagedMessages.length,
        messages: pagedMessages,
      };
    } finally {
      mailboxLock.release();
    }
  } finally {
    await imapClient.logout();
  }
}

async function saveEmailAttachments({
  attachmentHandler = null,
  parsedEmail = null,
} = {}) {
  if (typeof attachmentHandler !== "function" || !Array.isArray(parsedEmail?.attachments)) {
    return [];
  }
  const artifacts = [];
  let attachmentIndex = 0;
  for (const attachmentItem of parsedEmail.attachments) {
    const contentBuffer = Buffer.isBuffer(attachmentItem?.content)
      ? attachmentItem.content
      : null;
    if (!contentBuffer || !contentBuffer.length) continue;
    attachmentIndex += 1;
    const fileName = String(attachmentItem?.filename || "").trim() || `email_attachment_${attachmentIndex}`;
    const mimeType = String(attachmentItem?.contentType || "application/octet-stream")
      .trim()
      .toLowerCase();
    const contentDisposition = String(
      attachmentItem?.contentDisposition || "",
    ).trim().toLowerCase();
    const isInline =
      contentDisposition === "inline" || Boolean(attachmentItem?.cid);
    const contentId = String(attachmentItem?.cid || "").trim();
    artifacts.push({
      name: fileName,
      mimeType,
      contentBase64: contentBuffer.toString("base64"),
      email_attachment_type: isInline ? "inline" : "attachment",
      email_content_id: contentId,
      email_is_inline: isInline,
    });
  }
  if (!artifacts.length) return [];
  const savedAttachmentMetas = await attachmentHandler(artifacts, {
    generationSource: "email_connector_read",
  });
  return Array.isArray(savedAttachmentMetas) ? savedAttachmentMetas : [];
}

async function executeReadEmail({
  payload = {},
  connectionInfo = {},
  attachmentHandler = null,
} = {}) {
  const { ImapFlow } = await import("imapflow");
  const { simpleParser } = await import("mailparser");
  const normalizedConnectionInfo = normalizeEmailConnectionInfo(connectionInfo);
  const folder = String(payload?.folder || "INBOX").trim() || "INBOX";
  const uid = Number(payload?.uid || 0);
  const imapClient = new ImapFlow({
    host: normalizedConnectionInfo.imapHost,
    port: normalizedConnectionInfo.imapPort,
    secure: normalizedConnectionInfo.imapSecure,
    auth: {
      user: normalizedConnectionInfo.username,
      pass: normalizedConnectionInfo.password,
    },
  });
  await imapClient.connect();
  try {
    const mailboxLock = await imapClient.getMailboxLock(folder);
    try {
      let resolvedUid = Number.isFinite(uid) && uid > 0 ? Math.floor(uid) : 0;
      if (!resolvedUid) {
        const allUids = await imapClient.search({});
        const latestUid = (Array.isArray(allUids) ? allUids : [])
          .map((uidItem) => Number(uidItem || 0))
          .filter((uidItem) => Number.isFinite(uidItem) && uidItem > 0)
          .sort((leftUid, rightUid) => rightUid - leftUid)?.[0];
        resolvedUid = Number(latestUid || 0);
      }
      if (!resolvedUid) {
        throw new Error("email read action requires uid, and INBOX has no readable message");
      }
      let fetchedMessages = null;
      for await (const messageItem of imapClient.fetch([resolvedUid], {
        uid: true,
        envelope: true,
        source: true,
        internalDate: true,
      }, { uid: true })) {
        fetchedMessages = messageItem;
        break;
      }
      if (!fetchedMessages) {
        // 兼容：有些客户端可能错误地传入了序号而非 UID，这里做一次兜底
        fetchedMessages = await imapClient.fetchOne(resolvedUid, {
          uid: true,
          envelope: true,
          source: true,
          internalDate: true,
        });
      }
      if (!fetchedMessages) {
        throw new Error(`email not found by uid: ${resolvedUid}`);
      }
      const rawSourceBuffer = await (async () => {
        const sourceValue = fetchedMessages?.source;
        if (!sourceValue) return Buffer.from("");
        if (Buffer.isBuffer(sourceValue)) return sourceValue;
        if (typeof sourceValue === "string") return Buffer.from(sourceValue);
        if (sourceValue instanceof Uint8Array) return Buffer.from(sourceValue);
        if (typeof sourceValue?.[Symbol.asyncIterator] === "function") {
          const sourceChunks = [];
          for await (const sourceChunk of sourceValue) {
            if (!sourceChunk) continue;
            sourceChunks.push(
              Buffer.isBuffer(sourceChunk)
                ? sourceChunk
                : sourceChunk instanceof Uint8Array
                  ? Buffer.from(sourceChunk)
                  : Buffer.from(String(sourceChunk || "")),
            );
          }
          return Buffer.concat(sourceChunks);
        }
        if (typeof sourceValue?.[Symbol.iterator] === "function") {
          const sourceChunks = [];
          for (const sourceChunk of sourceValue) {
            if (!sourceChunk) continue;
            sourceChunks.push(
              Buffer.isBuffer(sourceChunk)
                ? sourceChunk
                : sourceChunk instanceof Uint8Array
                  ? Buffer.from(sourceChunk)
                  : Buffer.from(String(sourceChunk || "")),
            );
          }
          return Buffer.concat(sourceChunks);
        }
        return Buffer.from(String(sourceValue || ""));
      })();
      const parsedEmail = await simpleParser(
        rawSourceBuffer,
      );
      const attachmentMetas = await saveEmailAttachments({
        attachmentHandler,
        parsedEmail,
      });
      const inlineAttachmentMetas = attachmentMetas.filter(
        (attachmentItem) => attachmentItem?.email_is_inline === true,
      );
      const inlineAttachmentTextLines = inlineAttachmentMetas.map(
        (attachmentItem, attachmentIndex) =>
          `- [内嵌${attachmentIndex + 1}] name=${String(
            attachmentItem?.name || "unknown",
          ).trim()}, cid=${String(
            attachmentItem?.email_content_id || "none",
          ).trim()}, type=${String(
            attachmentItem?.mimeType || "application/octet-stream",
          ).trim()}`,
      );
      const baseText = String(parsedEmail?.text || "").trim();
      const textWithInlineAttachmentHint = inlineAttachmentTextLines.length
        ? [
            baseText,
            "",
            "[内嵌附件]",
            ...inlineAttachmentTextLines,
            "[/内嵌附件]",
          ]
            .filter((lineItem) => lineItem !== "")
            .join("\n")
        : baseText;
      const baseHtml = String(parsedEmail?.html || "").trim();
      const htmlWithInlineAttachmentHint = inlineAttachmentTextLines.length
        ? `${baseHtml}${
            baseHtml ? "<hr/>" : ""
          }<div><strong>内嵌附件</strong><ul>${inlineAttachmentMetas
            .map(
              (attachmentItem, attachmentIndex) =>
                `<li>[内嵌${attachmentIndex + 1}] ${String(
                  attachmentItem?.name || "unknown",
                ).trim()} (cid=${String(
                  attachmentItem?.email_content_id || "none",
                ).trim()}, type=${String(
                  attachmentItem?.mimeType || "application/octet-stream",
                ).trim()})</li>`,
            )
            .join("")}</ul></div>`
        : baseHtml;
      return {
        action: "read",
        folder,
        uid: Number(fetchedMessages?.uid || resolvedUid),
        subject: String(parsedEmail?.subject || fetchedMessages?.envelope?.subject || "").trim(),
        from: Array.isArray(parsedEmail?.from?.value)
          ? parsedEmail.from.value.map((addressItem) =>
              `${String(addressItem?.name || "").trim()} <${String(
                addressItem?.address || "",
              ).trim()}>`.trim(),
            )
          : [],
        to: Array.isArray(parsedEmail?.to?.value)
          ? parsedEmail.to.value.map((addressItem) =>
              `${String(addressItem?.name || "").trim()} <${String(
                addressItem?.address || "",
              ).trim()}>`.trim(),
            )
          : [],
        cc: Array.isArray(parsedEmail?.cc?.value)
          ? parsedEmail.cc.value.map((addressItem) =>
              `${String(addressItem?.name || "").trim()} <${String(
                addressItem?.address || "",
              ).trim()}>`.trim(),
            )
          : [],
        date: String(parsedEmail?.date || fetchedMessages?.internalDate || ""),
        text: textWithInlineAttachmentHint,
        html: htmlWithInlineAttachmentHint,
        attachment_metas: attachmentMetas,
      };
    } finally {
      mailboxLock.release();
    }
  } finally {
    await imapClient.logout();
  }
}

export async function executeEmailCommand({
  command = "",
  connectionInfo = {},
  attachmentHandler = null,
} = {}) {
  try {
    const { action, payload } = parseEmailCommand(command);
    let resultPayload = {};
    if (action === "send") {
      resultPayload = await executeSendEmail({ payload, connectionInfo });
    } else if (action === "list") {
      resultPayload = await executeListEmail({ payload, connectionInfo });
    } else if (action === "read") {
      resultPayload = await executeReadEmail({
        payload,
        connectionInfo,
        attachmentHandler,
      });
    }
    return {
      ok: true,
      code: 0,
      stdout: JSON.stringify(resultPayload),
      stderr: "",
    };
  } catch (error) {
    return {
      ok: false,
      code: 1,
      stdout: "",
      stderr: String(error?.message || error || "email command failed"),
    };
  }
}
