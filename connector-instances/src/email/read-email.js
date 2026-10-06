/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { createImapClient, normalizeEmailConnectionInfo } from "./connection.js";
import { normalizeTransferEnvelopes } from "@noobot/semantic-transfer-protocol";

const BINARY_MIME_TYPE = "application/octet-stream";

const INLINE_ATTACHMENT_ITEM_PREFIX = "INLINE";
const INLINE_ATTACHMENT_BLOCK_START = "[INLINE_ATTACHMENTS]";
const INLINE_ATTACHMENT_BLOCK_END = "[/INLINE_ATTACHMENTS]";
const INLINE_ATTACHMENT_TITLE_TEXT = "INLINE_ATTACHMENTS";

function normalizeTransferEnvelopesFromPayload(payload = null) {
  return normalizeTransferEnvelopes(payload?.transferEnvelopes || []);
}

async function saveEmailAttachments({ attachmentHandler = null, parsedEmail = null } = {}) {
  if (typeof attachmentHandler !== "function" || !Array.isArray(parsedEmail?.attachments)) {
    return {
      attachments: [],
      transferEnvelopes: [],
    };
  }
  const artifacts = [];
  let attachmentIndex = 0;
  for (const attachmentItem of parsedEmail.attachments) {
    const contentBuffer = Buffer.isBuffer(attachmentItem?.content) ? attachmentItem.content : null;
    if (!contentBuffer || !contentBuffer.length) continue;
    attachmentIndex += 1;
    const fileName =
      String(attachmentItem?.filename || "").trim() || `email_attachment_${attachmentIndex}`;
    const mimeType = String(attachmentItem?.contentType || BINARY_MIME_TYPE)
      .trim()
      .toLowerCase();
    const contentDisposition = String(attachmentItem?.contentDisposition || "")
      .trim()
      .toLowerCase();
    const isInline = contentDisposition === "inline" || Boolean(attachmentItem?.cid);
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
  if (!artifacts.length) {
    return {
      attachments: [],
      transferEnvelopes: [],
    };
  }
  const savedOutput = await attachmentHandler(artifacts, {
    generationSource: "email_connector_read",
  });
  if (Array.isArray(savedOutput)) {
    return {
      attachments: savedOutput,
      transferEnvelopes: [],
    };
  }
  if (!savedOutput || typeof savedOutput !== "object") {
    return {
      attachments: [],
      transferEnvelopes: [],
    };
  }
  return {
    attachments: Array.isArray(savedOutput?.attachments) ? savedOutput.attachments : [],
    transferEnvelopes: normalizeTransferEnvelopesFromPayload(savedOutput),
  };
}

function toBufferChunk(sourceChunk) {
  if (Buffer.isBuffer(sourceChunk)) return sourceChunk;
  if (sourceChunk instanceof Uint8Array) return Buffer.from(sourceChunk);
  return Buffer.from(String(sourceChunk || ""));
}

function isIterableSource(sourceValue) {
  return (
    typeof sourceValue?.[Symbol.asyncIterator] === "function" ||
    typeof sourceValue?.[Symbol.iterator] === "function"
  );
}

export async function readEmailSourceBuffer(sourceValue) {
  if (!sourceValue) return Buffer.from("");
  if (typeof sourceValue === "string") return Buffer.from(sourceValue);
  if (sourceValue instanceof Uint8Array) return toBufferChunk(sourceValue);
  if (!isIterableSource(sourceValue)) return Buffer.from(String(sourceValue || ""));
  const sourceChunks = [];
  for await (const sourceChunk of sourceValue) {
    if (sourceChunk) sourceChunks.push(toBufferChunk(sourceChunk));
  }
  return Buffer.concat(sourceChunks);
}

const EMAIL_FETCH_QUERY = Object.freeze({
  uid: true,
  envelope: true,
  source: true,
  internalDate: true,
});

const emailFetchQuery = () => ({ ...EMAIL_FETCH_QUERY });

async function fetchEmailByUid(imapClient, resolvedUid) {
  for await (const messageItem of imapClient.fetch([resolvedUid], emailFetchQuery(), {
    uid: true,
  })) {
    return messageItem;
  }
  return imapClient.fetchOne(resolvedUid, emailFetchQuery());
}

async function fetchLatestEmail(imapClient) {
  const mailboxExists = Number(imapClient?.mailbox?.exists || 0);
  if (!Number.isFinite(mailboxExists) || mailboxExists <= 0) return null;
  return imapClient.fetchOne("*", emailFetchQuery());
}

async function fetchEmailMessage(imapClient, resolvedUid) {
  const fetchedMessage = resolvedUid
    ? await fetchEmailByUid(imapClient, resolvedUid)
    : await fetchLatestEmail(imapClient);
  if (fetchedMessage) return fetchedMessage;
  if (!resolvedUid) throw new Error("Email uid is required when the mailbox is empty");
  throw new Error(`Email was not found by uid: ${resolvedUid}`);
}

function describeInlineAttachment(attachmentItem, attachmentIndex) {
  return {
    label: `${INLINE_ATTACHMENT_ITEM_PREFIX}${attachmentIndex + 1}`,
    name: String(attachmentItem?.name || "unknown").trim(),
    contentId: String(attachmentItem?.email_content_id || "none").trim(),
    mimeType: String(attachmentItem?.mimeType || BINARY_MIME_TYPE).trim(),
  };
}

function appendInlineAttachmentText(baseText, descriptors) {
  if (!descriptors.length) return baseText;
  return [
    baseText,
    "",
    INLINE_ATTACHMENT_BLOCK_START,
    ...descriptors.map(
      ({ label, name, contentId, mimeType }) =>
        `- [${label}] name=${name}, cid=${contentId}, type=${mimeType}`,
    ),
    INLINE_ATTACHMENT_BLOCK_END,
  ]
    .filter((lineItem) => lineItem !== "")
    .join("\n");
}

function appendInlineAttachmentHtml(baseHtml, descriptors) {
  if (!descriptors.length) return baseHtml;
  const items = descriptors
    .map(
      ({ label, name, contentId, mimeType }) =>
        `<li>[${label}] ${name} (cid=${contentId}, type=${mimeType})</li>`,
    )
    .join("");
  const separator = baseHtml ? "<hr/>" : "";
  return `${baseHtml}${separator}<div><strong>${INLINE_ATTACHMENT_TITLE_TEXT}</strong><ul>${items}</ul></div>`;
}

function formatAddressList(addressField) {
  if (!Array.isArray(addressField?.value)) return [];
  return addressField.value.map((addressItem) =>
    `${String(addressItem?.name || "").trim()} <${String(addressItem?.address || "").trim()}>`.trim(),
  );
}

function buildReadEmailHeaders({ folder, resolvedUid, fetchedMessage, parsedEmail }) {
  return {
    action: "read",
    folder,
    uid: Number(fetchedMessage?.uid || resolvedUid),
    subject: String(parsedEmail?.subject || fetchedMessage?.envelope?.subject || "").trim(),
    from: formatAddressList(parsedEmail?.from),
    to: formatAddressList(parsedEmail?.to),
    cc: formatAddressList(parsedEmail?.cc),
    date: String(parsedEmail?.date || fetchedMessage?.internalDate || ""),
  };
}

function buildReadEmailBody(parsedEmail, attachments) {
  const descriptors = attachments
    .filter((attachmentItem) => attachmentItem?.email_is_inline === true)
    .map(describeInlineAttachment);
  return {
    text: appendInlineAttachmentText(String(parsedEmail?.text || "").trim(), descriptors),
    html: appendInlineAttachmentHtml(String(parsedEmail?.html || "").trim(), descriptors),
  };
}

function buildReadEmailResult({ folder, resolvedUid, fetchedMessage, parsedEmail, persisted }) {
  const attachments = Array.isArray(persisted?.attachments) ? persisted.attachments : [];
  const transferEnvelopes = persisted?.transferEnvelopes;
  return {
    ...buildReadEmailHeaders({ folder, resolvedUid, fetchedMessage, parsedEmail }),
    ...buildReadEmailBody(parsedEmail, attachments),
    attachments,
    ...(Array.isArray(transferEnvelopes) && transferEnvelopes.length ? { transferEnvelopes } : {}),
  };
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
  const imapClient = createImapClient(ImapFlow, normalizedConnectionInfo);
  await imapClient.connect();
  try {
    const mailboxLock = await imapClient.getMailboxLock(folder);
    try {
      const requestedUid = Number.isFinite(uid) && uid > 0 ? Math.floor(uid) : 0;
      const fetchedMessage = await fetchEmailMessage(imapClient, requestedUid);
      const resolvedUid = Number(fetchedMessage?.uid || requestedUid);
      const rawSourceBuffer = await readEmailSourceBuffer(fetchedMessage?.source);
      const parsedEmail = await simpleParser(rawSourceBuffer);
      const persisted = await saveEmailAttachments({ attachmentHandler, parsedEmail });
      return buildReadEmailResult({ folder, resolvedUid, fetchedMessage, parsedEmail, persisted });
    } finally {
      mailboxLock.release();
    }
  } finally {
    await imapClient.logout();
  }
}
