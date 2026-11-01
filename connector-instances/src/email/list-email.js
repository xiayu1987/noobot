/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { createImapClient, normalizeEmailConnectionInfo } from "./connection.js";
import { text } from "@noobot/shared/value";

function normalizeListPaging(payload = {}) {
  const page = Number(payload?.page || 1);
  const pageSize = Number(payload?.page_size || 10);
  const normalizedPage = Number.isFinite(page) && page > 0 ? Math.floor(page) : 1;
  const normalizedPageSize =
    Number.isFinite(pageSize) && pageSize > 0 ? Math.min(Math.floor(pageSize), 50) : 10;
  return {
    page: normalizedPage,
    pageSize: normalizedPageSize,
  };
}

function toEmailMessageTimestamp(dateValue = "") {
  const timestamp = new Date(dateValue).getTime();
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function normalizeEmailAddressList(addressList = []) {
  return Array.isArray(addressList)
    ? addressList.map((addressItem) =>
        `${text(addressItem?.name)} <${text(addressItem?.address)}>`.trim(),
      )
    : [];
}

function normalizeEmailSummary(messageItem = {}) {
  return {
    uid: Number(messageItem?.uid || 0),
    subject: text(messageItem?.envelope?.subject),
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

async function fetchEmailSummaries(imapClient, range, options) {
  const summaries = [];
  for await (const message of imapClient.fetch(
    range,
    {
      uid: true,
      envelope: true,
      internalDate: true,
    },
    options,
  )) {
    summaries.push(normalizeEmailSummary(message));
  }
  return summaries;
}

async function listMailboxMessages(imapClient, { folder, page, pageSize, unseenOnly }) {
  let totalCount = Number(imapClient?.mailbox?.exists || 0);
  if (!Number.isFinite(totalCount) || totalCount < 0) totalCount = 0;
  let messageSummaries;
  if (unseenOnly) {
    const unseenUids = await imapClient.search({ seen: false }, { uid: true });
    const normalizedUids = (Array.isArray(unseenUids) ? unseenUids : [])
      .map((uidItem) => Number(uidItem || 0))
      .filter((uidItem) => Number.isFinite(uidItem) && uidItem > 0);
    totalCount = normalizedUids.length;
    messageSummaries = normalizedUids.length
      ? await fetchEmailSummaries(imapClient, normalizedUids, { uid: true })
      : [];
  } else {
    const sequenceRange = buildRecentSequenceRange({ page, pageSize, exists: totalCount });
    messageSummaries = sequenceRange ? await fetchEmailSummaries(imapClient, sequenceRange) : [];
  }
  const latestMessages = messageSummaries.sort(sortEmailSummariesByLatest);
  const messages = unseenOnly
    ? latestMessages.slice((page - 1) * pageSize, page * pageSize)
    : latestMessages;
  return {
    action: "list",
    folder,
    page,
    page_size: pageSize,
    total_count: totalCount,
    count: messages.length,
    messages,
  };
}

export async function executeListEmail({ payload = {}, connectionInfo = {} } = {}) {
  const { ImapFlow } = await import("imapflow");
  const normalizedConnectionInfo = normalizeEmailConnectionInfo(connectionInfo);
  const folder = text(payload?.folder) || "INBOX";
  const { page, pageSize } = normalizeListPaging(payload);
  const unseenOnly = payload?.unseen_only === true;

  const imapClient = createImapClient(ImapFlow, normalizedConnectionInfo);

  await imapClient.connect();
  try {
    const mailboxLock = await imapClient.getMailboxLock(folder);
    try {
      return await listMailboxMessages(imapClient, { folder, page, pageSize, unseenOnly });
    } finally {
      mailboxLock.release();
    }
  } finally {
    await imapClient.logout();
  }
}
