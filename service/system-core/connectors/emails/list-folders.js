/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { normalizeEmailConnectionInfo } from "./connection.js";

export async function executeListFolders({ connectionInfo = {} } = {}) {
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
