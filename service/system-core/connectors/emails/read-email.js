/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { tSystem } from "../../i18n/system-text.js";
import { normalizeEmailConnectionInfo } from "./connection.js";

const INLINE_ATTACHMENT_ITEM_PREFIX = "INLINE";
const INLINE_ATTACHMENT_BLOCK_START = "[INLINE_ATTACHMENTS]";
const INLINE_ATTACHMENT_BLOCK_END = "[/INLINE_ATTACHMENTS]";
const INLINE_ATTACHMENT_TITLE_TEXT = "INLINE_ATTACHMENTS";

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

export async function executeReadEmail({
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
          fetchedMessages = await imapClient.fetchOne(resolvedUid, {
            uid: true,
            envelope: true,
            source: true,
            internalDate: true,
          });
        }
      } else {
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
      const parsedEmail = await simpleParser(rawSourceBuffer);
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
