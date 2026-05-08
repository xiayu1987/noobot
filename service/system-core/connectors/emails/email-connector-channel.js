/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { tSystem } from "../../i18n/system-text.js";

const INLINE_ATTACHMENT_ITEM_PREFIX = "INLINE";
const INLINE_ATTACHMENT_BLOCK_START = "[INLINE_ATTACHMENTS]";
const INLINE_ATTACHMENT_BLOCK_END = "[/INLINE_ATTACHMENTS]";
const INLINE_ATTACHMENT_TITLE_TEXT = "INLINE_ATTACHMENTS";

function parseEmailCommand(command = "") {
  const normalizedCommand = String(command || "").trim();
  if (!normalizedCommand) {
    throw new Error(tSystem("connectors.email.commandRequired"));
  }
  let parsedCommand = null;
  try {
    parsedCommand = JSON.parse(normalizedCommand);
  } catch {
    throw new Error(
      `${tSystem("connectors.email.commandJsonStringRequired")}, e.g. {"action":"send",...}`,
    );
  }
  if (!parsedCommand || typeof parsedCommand !== "object") {
    throw new Error(tSystem("connectors.email.commandJsonObjectRequired"));
  }
  const action = String(parsedCommand?.action || "").trim().toLowerCase();
  if (!["send", "list", "read", "list_folders"].includes(action)) {
    throw new Error(tSystem("connectors.email.commandActionInvalid"));
  }
  return { action, payload: parsedCommand };
}

function normalizeListPaging(payload = {}) {
  const page = Number(payload?.page || 1);
  const pageSize = Number(payload?.page_size || 10);
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

function toEmailMessageTimestamp(dateValue = "") {
  const timestamp = new Date(dateValue).getTime();
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function normalizeEmailAddressList(addressList = []) {
  return Array.isArray(addressList)
    ? addressList.map((addressItem) =>
        `${String(addressItem?.name || "").trim()} <${String(
          addressItem?.address || "",
        ).trim()}>`.trim(),
      )
    : [];
}

function normalizeEmailSummary(messageItem = {}) {
  return {
    uid: Number(messageItem?.uid || 0),
    subject: String(messageItem?.envelope?.subject || "").trim(),
    from: normalizeEmailAddressList(messageItem?.envelope?.from),
    date: String(messageItem?.internalDate || ""),
  };
}

function sortEmailSummariesByLatest(leftMessage = {}, rightMessage = {}) {
  const rightTimestamp = toEmailMessageTimestamp(rightMessage?.date);
  const leftTimestamp = toEmailMessageTimestamp(leftMessage?.date);
  if (rightTimestamp !== leftTimestamp) return rightTimestamp - leftTimestamp;
  return Number(rightMessage?.uid || 0) - Number(leftMessage?.uid || 0);
}

function buildRecentSequenceRange({ page = 1, pageSize = 10, exists = 0 } = {}) {
  const normalizedExists = Number(exists || 0);
  if (!Number.isFinite(normalizedExists) || normalizedExists <= 0) return "";
  const endSeq = normalizedExists - (page - 1) * pageSize;
  const startSeq = Math.max(endSeq - pageSize + 1, 1);
  if (endSeq <= 0 || startSeq > endSeq) return "";
  return `${startSeq}:${endSeq}`;
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

async function executeListFolders({ connectionInfo = {} } = {}) {
  const { ImapFlow } = await import("imapflow");
  const normalizedConnectionInfo = normalizeEmailConnectionInfo(connectionInfo);
  const imapClient = new ImapFlow({
    logger: false,
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
    const folderTree = await imapClient.list();
    const folders = (Array.isArray(folderTree) ? folderTree : []).map((item) => ({
      path: String(item?.path || ""),
      name: String(item?.name || ""),
      delimiter: String(item?.delimiter || "/"),
      flags: Array.isArray(item?.flags) ? Array.from(item.flags) : [],
    }));
    return { action: "list_folders", folders };
  } finally {
    await imapClient.logout();
  }
}

async function executeListEmail({ payload = {}, connectionInfo = {} } = {}) {
  const { ImapFlow } = await import("imapflow");
  const normalizedConnectionInfo = normalizeEmailConnectionInfo(connectionInfo);
  const folder = String(payload?.folder || "INBOX").trim() || "INBOX";
  const { page, pageSize } = normalizeListPaging(payload);
  const unseenOnly = payload?.unseen_only === true;

  const imapClient = new ImapFlow({
    logger: false,
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
      const messageSummaries = [];
      let totalCount = Number(imapClient?.mailbox?.exists || 0);
      if (!Number.isFinite(totalCount) || totalCount < 0) totalCount = 0;

      if (unseenOnly) {
        const unseenUids = await imapClient.search({ seen: false }, { uid: true });
        const normalizedUids = (Array.isArray(unseenUids) ? unseenUids : [])
          .map((uidItem) => Number(uidItem || 0))
          .filter((uidItem) => Number.isFinite(uidItem) && uidItem > 0);
        totalCount = normalizedUids.length;
        if (normalizedUids.length) {
          for await (const messageItem of imapClient.fetch(normalizedUids, {
            uid: true,
            envelope: true,
            internalDate: true,
          }, { uid: true })) {
            messageSummaries.push(normalizeEmailSummary(messageItem));
          }
        }
      } else {
        const sequenceRange = buildRecentSequenceRange({
          page,
          pageSize,
          exists: totalCount,
        });
        if (sequenceRange) {
          for await (const messageItem of imapClient.fetch(sequenceRange, {
            uid: true,
            envelope: true,
            internalDate: true,
          })) {
            messageSummaries.push(normalizeEmailSummary(messageItem));
          }
        }
      }

      const latestMessages = messageSummaries.sort(sortEmailSummariesByLatest);
      const pagedMessages = unseenOnly
        ? latestMessages.slice((page - 1) * pageSize, page * pageSize)
        : latestMessages;

      if (!pagedMessages.length) {
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
    logger: false,
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
      let fetchedMessages = null;

      if (resolvedUid) {
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
      } else {
        // 不传 uid 时直接读取当前邮箱最后一封序号邮件，比先 SEARCH 再取最大 UID
        // 更贴近 IMAP 服务器当前可见的“最新邮件”。
        const mailboxExists = Number(imapClient?.mailbox?.exists || 0);
        if (Number.isFinite(mailboxExists) && mailboxExists > 0) {
          fetchedMessages = await imapClient.fetchOne("*", {
            uid: true,
            envelope: true,
            source: true,
            internalDate: true,
          });
        }
      }
      if (!fetchedMessages) {
        if (!resolvedUid) {
          throw new Error(tSystem("connectors.email.readUidRequired"));
        }
        throw new Error(`${tSystem("connectors.email.notFoundByUid")}: ${resolvedUid}`);
      }
      resolvedUid = Number(fetchedMessages?.uid || resolvedUid);
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
          `- [${INLINE_ATTACHMENT_ITEM_PREFIX}${attachmentIndex + 1}] name=${String(
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
            INLINE_ATTACHMENT_BLOCK_START,
            ...inlineAttachmentTextLines,
            INLINE_ATTACHMENT_BLOCK_END,
          ]
            .filter((lineItem) => lineItem !== "")
            .join("\n")
        : baseText;
      const baseHtml = String(parsedEmail?.html || "").trim();
      const htmlWithInlineAttachmentHint = inlineAttachmentTextLines.length
        ? `${baseHtml}${
            baseHtml ? "<hr/>" : ""
          }<div><strong>${INLINE_ATTACHMENT_TITLE_TEXT}</strong><ul>${inlineAttachmentMetas
            .map(
              (attachmentItem, attachmentIndex) =>
                `<li>[${INLINE_ATTACHMENT_ITEM_PREFIX}${attachmentIndex + 1}] ${String(
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
    } else if (action === "list_folders") {
      resultPayload = await executeListFolders({ connectionInfo });
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
