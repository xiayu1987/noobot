/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  createSessionFacade,
  createSessionServices,
  immutableSessionReaderAccess,
} from "noobot-agent/session";
import { AttachmentService } from "noobot-agent/attach";
import { resolveScopedSessionRoots } from "@noobot/workspace-protocol";

export function openRestartProjectionSession(workspaceRoot) {
  return createSessionFacade(
    createSessionServices(
      { workspaceRoot },
      {
        now: () => "2026-11-15T00:00:00.000Z",
        sessionReaderAccess: immutableSessionReaderAccess,
        attachmentService: new AttachmentService({ workspaceRoot }),
        scopedSessionRoots: resolveScopedSessionRoots([
          { pluginId: "workflow", scopedSessionRoots: ["session"] },
        ]),
      },
    ),
  );
}
