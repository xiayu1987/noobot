/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { createJsonRouteWrapper } from "./route-wrapper.js";
import { isSuperAdminRole } from "#agent/utils";

export function registerIdeRoutes(
  app,
  {
    openVSCodeService,
    readWorkspaceUsers,
    translateText,
  } = {},
) {
  const jsonRoute = createJsonRouteWrapper({ translateText });

  app.post(
    "/internal/ide/open/:userId",
    jsonRoute(async (req, res) => {
      const userId = String(req.params?.userId || req.auth?.userId || "").trim();
      const authUserId = String(req.auth?.userId || "").trim();
      const isSuperAdmin = isSuperAdminRole(req.auth?.role);
      if (
        !isSuperAdmin &&
        authUserId !== userId
      ) {
        res.status(403).json({ ok: false, error: "forbidden user scope" });
        return;
      }
      if (!isSuperAdmin) {
        const users = typeof readWorkspaceUsers === "function" ? await readWorkspaceUsers() : [];
        const matchedUser = (Array.isArray(users) ? users : []).find(
          (item) => String(item?.userId || "").trim() === userId,
        );
        if (matchedUser?.allowIDE !== true) {
          res.status(403).json({
            ok: false,
            error: translateText("auth.ideAccessDenied", req.locale),
          });
          return;
        }
      }
      const result = await openVSCodeService.openForUser(userId);
      res.json(result);
    }),
  );

  app.use("/ide", (req, res) => {
    openVSCodeService.proxyHttp(req, res);
  });
}
